import {afterEach, describe, expect, it, vi} from 'vitest';
import {fetchGitattributesGlobs, parseGeneratedGlobs} from './gitattributes';

describe('parseGeneratedGlobs', () => {
  it('collects patterns flagged linguist-generated=true', () => {
    const globs = parseGeneratedGlobs(
      ['*.pb.go linguist-generated=true', 'schema.sql linguist-generated=true'].join('\n'),
    );
    expect(globs).toEqual(['**/*.pb.go', '**/schema.sql']);
  });

  it('collects the bare linguist-generated attribute', () => {
    expect(parseGeneratedGlobs('vendor/** linguist-generated')).toEqual(['vendor/**']);
  });

  it('ignores patterns without the linguist-generated attribute', () => {
    const globs = parseGeneratedGlobs(
      ['*.png binary', '*.sh text eol=lf', '# a comment', ''].join('\n'),
    );
    expect(globs).toEqual([]);
  });

  it('ignores patterns that explicitly unset linguist-generated', () => {
    const globs = parseGeneratedGlobs(
      ['dist/** linguist-generated=true', 'dist/keep.js -linguist-generated'].join('\n'),
    );
    expect(globs).toEqual(['dist/**']);
  });

  it('roots a leading slash and expands a trailing slash to a directory glob', () => {
    const globs = parseGeneratedGlobs(
      ['/CHANGELOG.md linguist-generated=true', 'gen/ linguist-generated=true'].join('\n'),
    );
    expect(globs).toEqual(['CHANGELOG.md', 'gen/**']);
  });

  it('de-duplicates repeated patterns', () => {
    const globs = parseGeneratedGlobs(
      ['*.pb.go linguist-generated=true', '*.pb.go linguist-generated=true'].join('\n'),
    );
    expect(globs).toEqual(['**/*.pb.go']);
  });
});

describe('fetchGitattributesGlobs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unions the PR ref with the default branch, so a stale ref only misses PR-only globs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = input as string;
      if (url.includes('/raw/abc123/'))
        return new Response('only-on-ref.go linguist-generated=true');
      if (url.includes('/raw/HEAD/'))
        return new Response('only-on-default.go linguist-generated=true');
      return new Response('', {status: 404});
    });
    vi.stubGlobal('fetch', fetch);

    const globs = await fetchGitattributesGlobs('acme', 'widgets', 'abc123');
    expect(globs.sort()).toEqual(['**/only-on-default.go', '**/only-on-ref.go']);
  });

  it('fetches only once when the ref already is the default branch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response('a.go linguist-generated=true'),
    );
    vi.stubGlobal('fetch', fetch);

    await fetchGitattributesGlobs('acme', 'unique-repo-head', 'HEAD');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
