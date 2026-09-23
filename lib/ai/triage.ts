import type {SourceIndex} from './index';
import {inScope} from './search';

export const TRIAGE_ENDPOINT = 'https://classifier.dev/v1/classify';
const MAX_ITEM_CHARS = 6_000;
/** classifier.dev allows 1,000 item × dimension decisions per request. */
const BATCH = 500;
const SORTED_BY_PATH = new Set(['tests', 'specs', 'docs', 'generated']);

export const CHANGE_LABELS = [
  'behaviour change',
  'refactor with no behaviour change',
  'configuration or build',
  'formatting or renaming only',
] as const;
export const RISK_LABELS = [
  'authentication or permissions',
  'data, storage or migrations',
  'error handling',
  'concurrency or timing',
  'user-facing text or UI',
  'low risk',
] as const;

const DIMENSIONS = {
  change: {
    labels: [...CHANGE_LABELS],
    instructions: 'A code diff. Lines marked +R were added, -L removed, R unchanged.',
  },
  risk: {
    labels: [...RISK_LABELS],
    instructions: 'Pick the area where a mistake in this diff would do the most damage.',
  },
};

export interface TriageItem {
  path: string;
  /** Excerpt the page opens when this file is chosen. */
  sourceId: string;
  text: string;
}

export interface Verdict {
  label: string;
  confidence: number | null;
}

export interface TriageRow {
  path: string;
  sourceId: string;
  change: Verdict;
  risk: Verdict;
}

export interface TriageResult {
  rows: TriageRow[];
  /** Files left to their path category: tests, specs, docs and generated. */
  skipped: number;
  model: string;
  ms: number;
}

/** Thrown with classifier.dev's stable `code`, so the panel can say what to do. */
export class TriageError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** One item per code file in scope; path-sorted categories are not re-asked. */
export function triageItems(
  index: SourceIndex,
  scope = '',
): {items: TriageItem[]; skipped: number} {
  const byPath = new Map<string, TriageItem>();
  let skipped = 0;
  for (const file of index.files) {
    if (!inScope(file.path, scope) || file.binary) continue;
    if (SORTED_BY_PATH.has(file.category)) {
      skipped++;
      continue;
    }
    byPath.set(file.path, {path: file.path, sourceId: '', text: `File: ${file.path}\n`});
  }
  for (const chunk of index.chunks) {
    const item = byPath.get(chunk.path);
    if (!item) continue;
    item.sourceId ||= chunk.id;
    if (item.text.length < MAX_ITEM_CHARS)
      item.text = (item.text + chunk.text + '\n').slice(0, MAX_ITEM_CHARS);
  }
  return {items: [...byPath.values()].filter((item) => item.sourceId), skipped};
}

interface DimensionResult {
  label: string;
  confidence: number | null;
}

export async function triage(
  items: TriageItem[],
  {fetch: send = fetch, signal}: {fetch?: typeof fetch; signal?: AbortSignal} = {},
): Promise<Omit<TriageResult, 'skipped'>> {
  const rows: TriageRow[] = [];
  let model = '';
  let ms = 0;
  for (let start = 0; start < items.length; start += BATCH) {
    const batch = items.slice(start, start + BATCH);
    const started = performance.now();
    const response = await send(TRIAGE_ENDPOINT, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({items: batch.map((item) => item.text), dimensions: DIMENSIONS}),
      signal,
    });
    const body = (await response.json().catch(() => null)) as {
      code?: string;
      error?: string;
      model?: string;
      results?: Array<{dimensions?: Record<string, DimensionResult>}>;
    } | null;
    if (!response.ok) throw failure(response, body);
    if (body?.results?.length !== batch.length)
      throw new TriageError('classifier.dev returned an unexpected response.', 'bad_response');
    batch.forEach((item, i) => {
      const dimensions = body.results![i].dimensions ?? {};
      rows.push({
        path: item.path,
        sourceId: item.sourceId,
        change: verdict(dimensions.change),
        risk: verdict(dimensions.risk),
      });
    });
    model = body.model ?? model;
    ms += performance.now() - started;
  }
  return {rows, model, ms: Math.round(ms)};
}

const verdict = (result: DimensionResult | undefined): Verdict => ({
  label: result?.label ?? 'unknown',
  confidence: typeof result?.confidence === 'number' ? result.confidence : null,
});

function failure(response: Response, body: {code?: string; error?: string} | null): TriageError {
  const code = body?.code ?? `http_${response.status}`;
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After')) || undefined;
    return new TriageError(
      `classifier.dev’s free allowance is used up for now${retryAfter ? `. Try again in ${retryAfter}s` : '. Try again later'}.`,
      code,
      retryAfter,
    );
  }
  if (response.status === 400)
    return new TriageError('classifier.dev rejected this diff. Try a smaller scope.', code);
  return new TriageError('classifier.dev is unavailable. Try again shortly.', code);
}

export interface TriageGroups {
  /** Behaviour changes outside low risk, by risk area, most confident first. */
  careful: Array<{area: string; rows: TriageRow[]}>;
  mechanical: TriageRow[];
}

export function groupTriage(rows: TriageRow[]): TriageGroups {
  const areas = new Map<string, TriageRow[]>();
  const mechanical: TriageRow[] = [];
  for (const row of rows) {
    if (row.change.label === 'behaviour change' && row.risk.label !== 'low risk') {
      const list = areas.get(row.risk.label) ?? [];
      list.push(row);
      areas.set(row.risk.label, list);
    } else mechanical.push(row);
  }
  const score = (row: TriageRow): number => row.risk.confidence ?? 0;
  const careful = RISK_LABELS.filter((area) => areas.has(area)).map((area) => ({
    area,
    rows: areas.get(area)!.sort((a, b) => score(b) - score(a)),
  }));
  return {careful, mechanical: mechanical.sort((a, b) => a.path.localeCompare(b.path))};
}

export function triageMarkdown(result: TriageResult): string {
  const {careful, mechanical} = groupTriage(result.rows);
  const percent = (value: number | null): string =>
    value === null ? '' : ` (${Math.round(value * 100)}%)`;
  const lines = ['## Triage', ''];
  for (const group of careful) {
    lines.push(`### ${group.area}`);
    for (const row of group.rows) lines.push(`- \`${row.path}\`${percent(row.risk.confidence)}`);
    lines.push('');
  }
  if (mechanical.length) {
    lines.push('### Looks mechanical');
    for (const row of mechanical) lines.push(`- \`${row.path}\` · ${row.change.label}`);
    lines.push('');
  }
  lines.push(`_Classified by classifier.dev (${result.model}). Scores are leads, not proof._`);
  return lines.join('\n');
}
