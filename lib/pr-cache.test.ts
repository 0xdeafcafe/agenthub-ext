// @vitest-environment jsdom
import {describe, expect, it} from 'vitest';
import {
  displayCounts,
  extractHeadSha,
  extractBaseSha,
  isCacheFresh,
  prCacheKey,
  trimCache,
  type PrCacheEntry,
} from './pr-cache';

const count = (
  files: number,
  lines = 0,
): {files: number; added: number; removed: number; reviewed: number} => ({
  files,
  added: lines,
  removed: 0,
  reviewed: 0,
});

describe('prCacheKey', () => {
  it('keys by owner/repo#number', () => {
    expect(prCacheKey('octo', 'hello', '42')).toBe('octo/hello#42');
  });
});

describe('isCacheFresh', () => {
  const entry = {sha: 'abc1234', baseSha: 'def5678'};
  it('reuses counts only when the entire comparison is known and unchanged', () => {
    expect(isCacheFresh(entry, 'abc1234', 'def5678')).toBe(true);
    expect(isCacheFresh(entry, 'abc1234', '9999999')).toBe(false);
    expect(isCacheFresh(entry, '9999999', 'def5678')).toBe(false);
  });
  it('rejects legacy entries and comparisons with unknown revisions', () => {
    expect(isCacheFresh({sha: 'abc1234'}, 'abc1234', 'def5678')).toBe(false);
    expect(isCacheFresh(entry, 'abc1234', null)).toBe(false);
    expect(isCacheFresh(entry, null, 'def5678')).toBe(false);
    expect(isCacheFresh({sha: null}, null, null)).toBe(false);
  });
});

describe('displayCounts', () => {
  const cached = {tests: count(2, 35), code: count(16, 119)};

  it('seeds from the cache before any files mount', () => {
    expect(displayCounts(cached, {})).toBe(cached);
  });

  it('keeps the cache while live is behind', () => {
    expect(displayCounts(cached, {code: count(5, 40)})).toBe(cached);
  });

  it('hands over once live covers at least as many files', () => {
    const live = {tests: count(2, 35), code: count(16, 119)};
    const result = displayCounts(cached, live);
    expect(result).toBe(live);
    expect(result).not.toBe(cached);
  });

  it('never sums the two sources', () => {
    const result = displayCounts(cached, {code: count(16, 119)});
    expect(result.code.files).toBe(16);
  });

  it('ignores the cache entirely when none is stored', () => {
    const live = {code: count(3, 10)};
    expect(displayCounts(null, live)).toBe(live);
  });
});

describe('trimCache', () => {
  const entry = (ts: number): PrCacheEntry => ({sha: null, counts: {}, impactMap: null, ts});

  it('keeps everything under the cap', () => {
    const record = {a: entry(1), b: entry(2)};
    expect(Object.keys(trimCache(record, 25))).toEqual(['a', 'b']);
  });

  it('drops the oldest entries beyond the cap', () => {
    const record = Object.fromEntries(Array.from({length: 30}, (_, i) => [`pr${i}`, entry(i)]));
    const trimmed = trimCache(record, 25);
    expect(Object.keys(trimmed).length).toBe(25);
    expect(trimmed.pr0).toBeUndefined();
    expect(trimmed.pr29).toBeDefined();
  });
});

describe('extractHeadSha', () => {
  const doc = (payload: string): Document =>
    new DOMParser().parseFromString(
      `<html><head></head><body><script type="application/json">${payload}</script></body></html>`,
      'text/html',
    );

  it('finds headSha in embedded JSON', () => {
    expect(extractHeadSha(doc('{"pullRequest":{"headSha":"8ecd2b6f"}}'))).toBe('8ecd2b6f');
  });

  it('finds the other spellings', () => {
    expect(extractHeadSha(doc('{"headRefOid":"abc1234"}'))).toBe('abc1234');
    expect(extractHeadSha(doc('{"head_sha":"deadbeef"}'))).toBe('deadbeef');
  });

  it('reads the base revision independently of the head', () => {
    expect(extractBaseSha(doc('{"headSha":"8ecd2b6f","baseSha":"abc1234"}'))).toBe('abc1234');
    expect(extractBaseSha(doc('{"baseRefOid":"deadbeef"}'))).toBe('deadbeef');
    expect(extractBaseSha(doc('{"headSha":"abc1234"}'))).toBeNull();
  });

  it('returns null when no SHA is embedded', () => {
    expect(extractHeadSha(doc('{"nothing":"here"}'))).toBeNull();
  });
});
