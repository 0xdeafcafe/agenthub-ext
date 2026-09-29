import {describe, expect, it} from 'vitest';
import {repoFileCacheKey, trimRepoFileCache} from './repo-file-cache';

describe('repoFileCacheKey', () => {
  it('scopes by owner, repo, ref, and path so different files never collide', () => {
    const a = repoFileCacheKey('acme', 'widgets', 'abc123', '.gitattributes');
    const b = repoFileCacheKey('acme', 'widgets', 'abc123', '.github/pr-impact.yml');
    const c = repoFileCacheKey('acme', 'widgets', 'HEAD', '.gitattributes');
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('trimRepoFileCache', () => {
  it('keeps everything under the limit untouched', () => {
    const record = {a: {text: '', ts: 1}, b: {text: '', ts: 2}};
    expect(trimRepoFileCache(record, 5)).toBe(record);
  });

  it('drops the oldest entries once over the limit', () => {
    const record = {
      old: {text: '', ts: 1},
      mid: {text: '', ts: 2},
      new: {text: '', ts: 3},
    };
    expect(Object.keys(trimRepoFileCache(record, 2)).sort()).toEqual(['mid', 'new']);
  });
});
