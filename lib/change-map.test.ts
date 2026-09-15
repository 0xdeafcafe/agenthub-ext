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
