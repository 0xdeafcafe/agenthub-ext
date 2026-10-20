import {describe, expect, it} from 'vitest';
import {
  inventoryCacheKey,
  packInventory,
  trimInventories,
  unpackInventory,
} from './inventory-cache';

describe('inventory cache', () => {
  it('keys a diff by its path and both revisions, and refuses without them', () => {
    expect(inventoryCacheKey('/o/r/pull/1.diff', {head: 'b', base: 'a'})).toBe(
      'v1:/o/r/pull/1.diff@a..b',
    );
    expect(inventoryCacheKey('/o/r/pull/1.diff', {head: 'b', base: null})).toBeNull();
    expect(inventoryCacheKey('/o/r/pull/1.diff', {head: null, base: 'a'})).toBeNull();
  });

  it('round-trips files through the compact stored form', () => {
    const inventory = {
      complete: true,
      files: [
        {path: 'a.ts', added: 3, removed: 1, commentAdded: 1, commentRemoved: 0, binary: false},
        {path: 'b.png', added: 0, removed: 0, commentAdded: 0, commentRemoved: 0, binary: true},
      ],
    };
    expect(unpackInventory(packInventory(inventory))).toEqual(inventory);
  });

  it('keeps the newest entries', () => {
    const record = Object.fromEntries(
      Array.from({length: 5}, (_, i) => [`k${i}`, {files: [], ts: i}]),
    );
    expect(Object.keys(trimInventories(record, 2)).sort()).toEqual(['k3', 'k4']);
  });
});
