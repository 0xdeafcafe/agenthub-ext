import {describe, expect, it} from 'vitest';
import {parseGeneratedGlobs} from './gitattributes';

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
