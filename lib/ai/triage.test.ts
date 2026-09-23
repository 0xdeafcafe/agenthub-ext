import {describe, expect, it} from 'vitest';
import type {SourceChunk, SourceIndex} from './index';
import {
  TRIAGE_ENDPOINT,
  TriageError,
  groupTriage,
  triage,
  triageItems,
  triageMarkdown,
  type TriageRow,
} from './triage';

const chunk = (id: string, path: string, category: string, text = '+R1 x'): SourceChunk => ({
  id,
  path,
  category,
  text,
  oldStart: 1,
  oldEnd: 1,
  newStart: 1,
  newEnd: 1,
  added: 1,
  removed: 0,
});
const indexOf = (chunks: SourceChunk[], binary: string[] = []): SourceIndex => ({
  revision: 'r',
  files: [...new Map(chunks.map((c) => [c.path, c.category]))].map(([path, category]) => ({
    path,
    category,
    binary: binary.includes(path),
  })),
  chunks,
  omittedChunks: 0,
  truncatedLines: 0,
});
const answer = (change: string, risk: string, confidence = 0.9) => ({
  dimensions: {
    change: {label: change, confidence},
    risk: {label: risk, confidence},
  },
});
const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {status: 200, ...init});

describe('triageItems', () => {
  it('sends code and custom categories, and leaves path-sorted files alone', () => {
    const {items, skipped} = triageItems(
      indexOf([
        chunk('S1', 'src/auth.ts', 'code', '+R1 a'),
        chunk('S2', 'src/auth.ts', 'code', '+R9 b'),
        chunk('S3', 'server/api.ts', 'server'),
        chunk('S4', 'src/auth.test.ts', 'tests'),
        chunk('S5', 'README.md', 'docs'),
        chunk('S6', 'package-lock.json', 'generated'),
      ]),
    );
    expect(items.map((item) => [item.path, item.sourceId])).toEqual([
      ['src/auth.ts', 'S1'],
      ['server/api.ts', 'S3'],
    ]);
    expect(items[0].text).toBe('File: src/auth.ts\n+R1 a\n+R9 b\n');
    expect(skipped).toBe(3);
  });

  it('respects scope, skips binaries, and bounds each file', () => {
    const long = 'x'.repeat(10_000);
    const {items} = triageItems(
      indexOf(
        [
          chunk('S1', 'a/one.ts', 'code', long),
          chunk('S2', 'b/two.ts', 'code'),
          chunk('S3', 'a/logo.png', 'code'),
        ],
        ['a/logo.png'],
      ),
      'a',
    );
    expect(items.map((item) => item.path)).toEqual(['a/one.ts']);
    expect(items[0].text.length).toBe(6_000);
  });
});

describe('triage', () => {
  it('asks both dimensions in one request and keeps input order', async () => {
    const calls: RequestInit[] = [];
    const result = await triage(
      [
        {path: 'a.ts', sourceId: 'S1', text: 'File: a.ts'},
        {path: 'b.ts', sourceId: 'S2', text: 'File: b.ts'},
      ],
      {
        fetch: async (url, init) => {
          expect(url).toBe(TRIAGE_ENDPOINT);
          calls.push(init!);
          return json({
            model: 'jev-1',
            results: [
              answer('behaviour change', 'error handling'),
              answer('formatting or renaming only', 'low risk'),
            ],
          });
        },
      },
    );
    const body = JSON.parse(calls[0].body as string);
    expect(body.items).toEqual(['File: a.ts', 'File: b.ts']);
    expect(Object.keys(body.dimensions)).toEqual(['change', 'risk']);
    expect(result.model).toBe('jev-1');
    expect(result.rows.map((row) => [row.path, row.change.label, row.risk.label])).toEqual([
      ['a.ts', 'behaviour change', 'error handling'],
      ['b.ts', 'formatting or renaming only', 'low risk'],
    ]);
  });

  it('splits more than 500 files so each request stays under 1,000 decisions', async () => {
    const sizes: number[] = [];
    const items = Array.from({length: 1_001}, (_, i) => ({
      path: `${i}.ts`,
      sourceId: `S${i}`,
      text: 'x',
    }));
    const result = await triage(items, {
      fetch: async (_url, init) => {
        const count = JSON.parse(init!.body as string).items.length;
        sizes.push(count);
        return json({
          results: Array.from({length: count}, () => answer('behaviour change', 'low risk')),
        });
      },
    });
    expect(sizes).toEqual([500, 500, 1]);
    expect(result.rows).toHaveLength(1_001);
  });

  it('reports rate limits with the wait classifier.dev asked for', async () => {
    const error = await triage([{path: 'a.ts', sourceId: 'S1', text: 'x'}], {
      fetch: async () =>
        json(
          {code: 'rate_limit_minute', error: 'slow down'},
          {status: 429, headers: {'Retry-After': '12'}},
        ),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TriageError);
    expect((error as TriageError).code).toBe('rate_limit_minute');
    expect((error as TriageError).retryAfter).toBe(12);
  });

  it('keeps the upstream code for rejected and failed requests', async () => {
    const run = (response: Response) =>
      triage([{path: 'a.ts', sourceId: 'S1', text: 'x'}], {fetch: async () => response}).catch(
        (caught: TriageError) => caught.code,
      );
    expect(await run(json({code: 'input_too_long'}, {status: 400}))).toBe('input_too_long');
    expect(await run(new Response('down', {status: 503}))).toBe('http_503');
    expect(await run(json({results: []}))).toBe('bad_response');
  });
});

describe('groupTriage', () => {
  const row = (
    path: string,
    change: string,
    risk: string,
    confidence: number | null,
  ): TriageRow => ({
    path,
    sourceId: path,
    change: {label: change, confidence},
    risk: {label: risk, confidence},
  });

  it('puts risky behaviour changes first, by area and confidence', () => {
    const groups = groupTriage([
      row('b.ts', 'behaviour change', 'error handling', 0.5),
      row('a.ts', 'behaviour change', 'authentication or permissions', 0.6),
      row('c.ts', 'behaviour change', 'error handling', 0.9),
      row('d.ts', 'behaviour change', 'low risk', 0.9),
      row('e.ts', 'refactor with no behaviour change', 'authentication or permissions', 1),
    ]);
    expect(groups.careful.map((group) => [group.area, group.rows.map((r) => r.path)])).toEqual([
      ['authentication or permissions', ['a.ts']],
      ['error handling', ['c.ts', 'b.ts']],
    ]);
    expect(groups.mechanical.map((r) => r.path)).toEqual(['d.ts', 'e.ts']);
  });

  it('copies as Markdown with the model named', () => {
    const text = triageMarkdown({
      rows: [
        row('a.ts', 'behaviour change', 'error handling', 0.84),
        row('b.ts', 'configuration or build', 'low risk', null),
      ],
      skipped: 0,
      model: 'jev-1',
      ms: 1,
    });
    expect(text).toContain('### error handling\n- `a.ts` (84%)');
    expect(text).toContain('- `b.ts` · configuration or build');
    expect(text).toContain('classifier.dev (jev-1)');
  });
});
