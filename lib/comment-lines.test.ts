// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {CommentLines, commentRuns} from './comment-lines';

afterEach(() => document.body.replaceChildren());

const escape = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Classic unified rows: [kind, code], or 'hunk' for a hunk header. */
function classicFile(lines: Array<[string, string] | 'hunk'>): Element {
  const rows = lines
    .map((line) =>
      line === 'hunk'
        ? '<tr><td class="blob-num blob-num-hunk"></td><td class="blob-num blob-num-hunk"></td><td class="blob-code blob-code-inner blob-code-hunk">@@ -1,6 +1,11 @@</td></tr>'
        : `<tr><td class="blob-num blob-num-${line[0]}"></td><td class="blob-num blob-num-${line[0]}"></td><td class="blob-code blob-code-${line[0]} js-file-line"><span class="blob-code-inner blob-code-marker">${escape(line[1])}</span></td></tr>`,
    )
    .join('');
  document.body.innerHTML = `<div class="file js-file" id="diff-aaaaaaaa"><div class="file-header"></div><table><tbody>${rows}</tbody></table></div>`;
  return document.querySelector('.js-file')!;
}

const lengths = (container: Element): number[] =>
  commentRuns(container, 'src/a.ts').map((run) => run.length);

describe('comment runs', () => {
  it('groups consecutive comment-only lines and stops at code', () => {
    const file = classicFile([
      ['context', '// one'],
      ['addition', '// two'],
      ['addition', 'const a = 1; // inline stays code'],
      ['addition', '/**'],
      ['addition', ' * doc'],
      ['addition', ' */'],
      ['addition', 'export {};'],
    ]);
    expect(lengths(file)).toEqual([2, 3]);
  });

  it('breaks runs and resets lexer state at a hunk header', () => {
    const file = classicFile([['addition', '/* open'], 'hunk', ['addition', 'code();']]);
    expect(lengths(file)).toEqual([1]);
  });

  it('keeps old and new sides apart', () => {
    const file = classicFile([
      ['deletion', '/* removed block opens'],
      ['addition', 'stillCode();'],
      ['deletion', 'still inside */'],
    ]);
    expect(lengths(file)).toEqual([1, 1]);
  });
});

describe('CommentLines', () => {
  const longBlock = (): Element =>
    classicFile([
      ['addition', 'code();'],
      ...Array.from({length: 8}, (_, i): [string, string] => ['addition', `// line ${i}`]),
      ['addition', 'more();'],
      ['addition', '// short'],
    ]);

  it('folds a block over five lines down to its first and last line', () => {
    const file = longBlock();
    const lines = new CommentLines();
    let changes = 0;
    lines.apply(file, 'src/a.ts', 'fold', () => changes++);
    expect(file.querySelectorAll('.prix-comment-line')).toHaveLength(6);
    const fold = file.querySelector('.prix-comment-fold')!;
    expect(fold.textContent).toBe('⋯ 6 more comment lines');
    expect(fold.previousElementSibling!.textContent).toContain('// line 0');
    fold.querySelector('button')!.click();
    expect(changes).toBe(1);
    lines.apply(file, 'src/a.ts', 'fold', () => {});
    expect(file.querySelectorAll('.prix-comment-line, .prix-comment-fold')).toHaveLength(0);
  });

  it('hides every comment-only line, and show puts them back', () => {
    const file = longBlock();
    const lines = new CommentLines();
    lines.apply(file, 'src/a.ts', 'hide', () => {});
    expect(file.querySelectorAll('.prix-comment-line')).toHaveLength(9);
    expect(file.querySelector('.prix-comment-fold')).toBeNull();
    lines.apply(file, 'src/a.ts', 'show', () => {});
    expect(file.querySelectorAll('.prix-comment-line')).toHaveLength(0);
  });

  it('reads split-view context rows as old on the left and new on the right', () => {
    document.body.innerHTML = `<div class="file js-file" id="diff-aaaaaaaa"><table><tbody>
      <tr><td class="blob-num"></td><td class="blob-code blob-code-context"><span class="blob-code-inner">// a</span></td><td class="blob-num"></td><td class="blob-code blob-code-context"><span class="blob-code-inner">// a</span></td></tr>
      <tr><td class="blob-num"></td><td class="blob-code blob-code-deletion"><span class="blob-code-inner">x();</span></td><td class="blob-num"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner">// b</span></td></tr>
    </tbody></table></div>`;
    expect(lengths(document.querySelector('.js-file')!)).toEqual([1]);
  });
});
