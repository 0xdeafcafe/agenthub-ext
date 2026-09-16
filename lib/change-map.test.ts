import {describe, expect, it} from 'vitest';
import {groupChanges, layoutMap, type MapFile} from './change-map';

const file = (path: string, added: number): MapFile => ({
  path,
  added,
  removed: 0,
  viewed: false,
  state: 'visible',
  category: 'code',
});
describe('change clusters', () => {
  it('groups files by directory and supports drilling into nested folders', () => {
    const files = [
      file('src/ui/a.ts', 40),
      file('src/ui/b.ts', 10),
      file('src/api.ts', 25),
      file('docs/a.md', 5),
    ];
    expect(
      groupChanges(files).map((group) => [group.path, group.weight, group.files.length]),
    ).toEqual([
      ['src', 75, 3],
      ['docs', 5, 1],
    ]);
    expect(groupChanges(files, 'src').map((group) => group.path)).toEqual(['src/ui', 'src/api.ts']);
    expect(groupChanges(files, 'src/ui').map((group) => group.name)).toEqual(['a.ts', 'b.ts']);
  });
  it('covers the canvas with non-overlapping proportional tiles', () => {
    const groups = groupChanges(Array.from({length: 50}, (_, i) => file(`file-${i}.ts`, i + 1)));
    const tiles = layoutMap(groups);
    const total = groups.reduce((sum, group) => sum + group.weight, 0);
    expect(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0)).toBeCloseTo(10_000);
    for (const tile of tiles) {
      expect((tile.width * tile.height) / 10_000).toBeCloseTo(tile.group.weight / total);
      expect(tile.x + tile.width).toBeLessThanOrEqual(100.00001);
      expect(tile.y + tile.height).toBeLessThanOrEqual(100.00001);
    }
    for (const [i, a] of tiles.entries())
      for (const b of tiles.slice(i + 1)) {
        const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const vertical = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        expect(overlap < 0.00001 || vertical < 0.00001).toBe(true);
      }
  });
  it('keeps zero-line files discoverable', () => {
    expect(layoutMap(groupChanges([file('icon.png', 0)]))[0]).toMatchObject({
      width: 100,
      height: 100,
    });
    expect(layoutMap([])).toEqual([]);
  });
});

describe('large and incomplete inventories', () => {
  it('uses file area consistently when even one line count is unavailable', () => {
    const unknown = {...file('platform/auth.ts', 0), linesKnown: false};
    const groups = groupChanges([unknown, file('docs/readme.md', 9000)]);
    expect(groups.map((group) => group.weight)).toEqual([1, 1]);
  });
  it('splits a dominant monorepo folder into useful subdirectories', () => {
    const groups = groupChanges(
      [
        file('platform/auth/login.ts', 50),
        file('platform/auth/session.ts', 20),
        file('platform/ui/button.ts', 30),
        file('readme.md', 10),
      ],
      '',
      2,
    );
    expect(groups.map(({path, directory, weight}) => ({path, directory, weight}))).toEqual([
      {path: 'platform/auth', directory: true, weight: 70},
      {path: 'platform/ui', directory: true, weight: 30},
      {path: 'readme.md', directory: false, weight: 10},
    ]);
  });
});

it('smart clusters skip dominant wrapper folders in a monorepo', () => {
  const files = Array.from({length: 120}, (_, i) =>
    file(`platform/app/src/${i < 60 ? 'auth' : 'ui'}/file-${i}.ts`, 1),
  );
  files.push(file('docs/review.md', 10));
  const groups = groupChanges(files, '', 0);
  expect(groups.map((group) => group.path)).toEqual([
    'platform/app/src/auth',
    'platform/app/src/ui',
    'docs',
  ]);
  expect(groups.reduce((sum, group) => sum + group.weight, 0)).toBe(130);
  expect(groups.every((group) => group.name === group.path)).toBe(true);
});
