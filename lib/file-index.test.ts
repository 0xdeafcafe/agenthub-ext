import {describe, expect, it} from 'vitest';
import {adjustedLines, FileIndex} from './file-index';

describe('FileIndex', () => {
  it('seeds unmounted files and keeps authoritative comment counts across remounts', () => {
    const index = new FileIndex();
    index.seed(
      [{path: 'a.ts', added: 20, removed: 10, commentAdded: 4, commentRemoved: 2, binary: false}],
      () => 'code',
    );
    index.update('a.ts', 'code', {added: 2, removed: 1}, true);
    expect(index.counts.get('code')).toEqual({files: 1, added: 20, removed: 10, reviewed: 1});
    expect(adjustedLines(index.files.get('a.ts')!, true)).toEqual({added: 16, removed: 8});
    expect(index.countsFor(true).get('code')).toEqual({
      files: 1,
      added: 16,
      removed: 8,
      reviewed: 1,
    });
    expect(index.countsFor(true, (_, file) => !file.viewed).size).toBe(0);
  });
  it('counts a virtualized file once across any number of remounts', () => {
    const index = new FileIndex();
    for (let i = 0; i < 100; i++)
      index.update('src/main.ts', 'code', {added: 35, removed: 12}, false);
    expect(index.counts.get('code')).toEqual({files: 1, added: 35, removed: 12, reviewed: 0});
  });

  it('fills late stats and preserves them when a skeleton remounts', () => {
    const index = new FileIndex();
    index.update('src/main.ts', 'code', null, null);
    index.update('src/main.ts', 'code', {added: 35, removed: 12}, true);
    index.update('src/main.ts', 'code', null, null);
    expect(index.counts.get('code')).toEqual({files: 1, added: 35, removed: 12, reviewed: 1});
  });

  it('replaces changed stats and reviewed state instead of accumulating them', () => {
    const index = new FileIndex();
    index.update('a.ts', 'code', {added: 35, removed: 12}, true);
    index.update('b.ts', 'code', {added: 8, removed: 1}, true);
    index.update('a.ts', 'code', {added: 10, removed: 0}, false);
    expect(index.counts.get('code')).toEqual({files: 2, added: 18, removed: 1, reviewed: 1});
  });

  it('moves an existing file between categories without inflating totals', () => {
    const index = new FileIndex();
    index.update('a.ts', 'code', {added: 5, removed: 1}, true);
    index.update('a.ts', 'tests', null, null);
    expect(index.counts.get('code')).toEqual({files: 0, added: 0, removed: 0, reviewed: 0});
    expect(index.counts.get('tests')).toEqual({files: 1, added: 5, removed: 1, reviewed: 1});
  });
});
