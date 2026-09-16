import {describe, expect, it} from 'vitest';
import {CommentScanner} from './comments';

describe('comment-only line counts', () => {
  it('excludes comments while retaining code, URLs, quoted markers, and blank lines', () => {
    const scanner = new CommentScanner('src/main.ts');
    expect(
      [
        '// context',
        '  /* context */',
        'const url = "https://example.com";',
        'const text = "/* not a comment */";',
        'run(); // context',
        '',
        '   ',
      ].map((line) => scanner.scan(line)),
    ).toEqual([true, true, false, false, false, false, false]);
  });
  it('tracks block comments and code on either side of the delimiter', () => {
    const scanner = new CommentScanner('main.go');
    expect(
      [
        '/* description',
        ' * context',
        ' */',
        '/* comment */ run()',
        'run() /* comment',
        'continued */',
      ].map((line) => scanner.scan(line)),
    ).toEqual([true, true, true, false, false, true]);
  });
  it('keeps shebangs and regular-expression contents as code', () => {
    expect(new CommentScanner('script.sh').scan('#!/bin/sh')).toBe(false);
    const scanner = new CommentScanner('main.ts');
    expect(scanner.scan('const marker = /[/*]/;')).toBe(false);
    expect(scanner.scan('const next = 1;')).toBe(false);
    expect(scanner.scan('// actual comment')).toBe(true);
  });
  it('does not strip template content or Python docstrings', () => {
    const js = new CommentScanner('main.ts');
    expect(['const template = `', '// literal text', '`;'].map((line) => js.scan(line))).toEqual([
      false,
      false,
      false,
    ]);
    const py = new CommentScanner('main.py');
    expect(
      ['"""', '# documentation string', '"""', '# actual comment', 'x = "# literal"'].map((line) =>
        py.scan(line),
      ),
    ).toEqual([false, false, false, true, false]);
  });
  it('recognizes hash, SQL, and HTML comments without treating Markdown headings as comments', () => {
    expect(new CommentScanner('config.yml').scan('# note')).toBe(true);
    expect(new CommentScanner('Dockerfile').scan('# note')).toBe(true);
    expect(new CommentScanner('query.sql').scan('-- note')).toBe(true);
    expect(new CommentScanner('index.html').scan('<!-- note -->')).toBe(true);
    expect(new CommentScanner('README.md').scan('# Heading')).toBe(false);
    expect(new CommentScanner('config.json').scan('// not valid JSON')).toBe(false);
  });
});
