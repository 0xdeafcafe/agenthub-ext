import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {buildMarkdownReport, parseImpactMap} from './impact-report';

const fixture = (name: string): string =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

describe('parseImpactMap', () => {
  it('parses a two-category chart', () => {
    const map = parseImpactMap(fixture('impact-map-pr6798.txt'));
    expect(map).toEqual({
      commit: '116b957',
      totalFiles: 2,
      totalAdded: 40,
      totalRemoved: 129,
      categories: [
        {name: 'SDKs', files: 1, added: 1, removed: 1, share: 50},
        {name: 'Deps', files: 1, added: 39, removed: 128, share: 50},
      ],
    });
  });

  it('parses a multi-category chart', () => {
    const map = parseImpactMap(fixture('impact-map-pr5863.txt'));
    expect(map?.categories.map(c => [c.name, c.share])).toEqual([
      ['Deps', 43],
      ['Python', 29],
      ['SDKs', 29],
    ]);
    expect(map?.totalFiles).toBe(7);
    expect(map?.totalAdded).toBe(368);
    expect(map?.totalRemoved).toBe(315);
  });

  it('parses a single-category 100% chart with a slash in the name', () => {
    const map = parseImpactMap(fixture('impact-map-pr6790.txt'));
    expect(map?.categories).toEqual([{name: 'CI/CD', files: 6, added: 6, removed: 6, share: 100}]);
  });

  it('returns null when there is no chart', () => {
    expect(parseImpactMap('Just a regular comment\nwith several lines')).toBeNull();
    expect(parseImpactMap('')).toBeNull();
  });

  it('returns null on malformed charts', () => {
    expect(parseImpactMap('PR Impact Map · 2 files · +40 / -129 · 116b957\nno table here')).toBeNull();
    // rows but no total
    expect(
      parseImpactMap(
        'PR Impact Map · 1 file · +1 / -1 · abc1234\n  SDKs                1         +1        -1   ████████░░░░░░░  100%',
      ),
    ).toBeNull();
  });

  it('handles thousands separators', () => {
    const map = parseImpactMap(
      'PR Impact Map · 1 file · +1,275 / -1,181 · 39b542c\n' +
        '  Deps                1     +1,275    -1,181   ███████████████ 100%\n' +
        '  Total               1     +1,275    -1,181\n',
    );
    expect(map?.totalAdded).toBe(1275);
    expect(map?.categories[0].removed).toBe(1181);
  });
});

describe('buildMarkdownReport', () => {
  it('builds a markdown table', () => {
    expect(
      buildMarkdownReport([
        {name: 'SDKs', files: 1, added: 1, removed: 1, share: 50},
        {name: 'Deps', files: 1, added: 39, removed: 128, share: 50},
      ]),
    ).toBe(
      '| Category | Files | Added | Removed | Share |\n' +
        '| --- | ---: | ---: | ---: | ---: |\n' +
        '| SDKs | 1 | +1 | -1 | 50% |\n' +
        '| Deps | 1 | +39 | -128 | 50% |',
    );
  });
});
