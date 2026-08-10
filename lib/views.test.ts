// @vitest-environment jsdom
import {describe, expect, it} from 'vitest';
import {adapters, outerFileWrapper} from './views';

const react = adapters.find(adapter => adapter.name === 'react')!;

/** Minimal React-view file container: hashed module classes, stats as leaf spans. */
function reactContainer(headerInner: string, body = ''): Element {
  document.body.innerHTML = `
    <div id="diff-abc123">
      <div class="DiffFileHeader-module__diff-file-header__x9y2">
        ${headerInner}
      </div>
      ${body}
    </div>`;
  return document.querySelector('div[id^="diff-"]')!;
}

describe('react adapter getChangedLines', () => {
  it('parses +N/−N leaf stats from the header', () => {
    const container = reactContainer(`
      <h3 class="DiffFileHeader-module__file-name__a1"><code>src/foo.ts</code></h3>
      <span class="fgColor-success">+58</span>
      <span class="fgColor-danger">−22</span>
    `);
    expect(react.getChangedLines(container)).toEqual({added: 58, removed: 22});
  });

  it('accepts ASCII and en-dash minuses, and thousands separators', () => {
    const ascii = reactContainer('<span>+1,817</span> <span>-942</span>');
    expect(react.getChangedLines(ascii)).toEqual({added: 1817, removed: 942});
    const enDash = reactContainer('<span>+5</span> <span>–3</span>');
    expect(react.getChangedLines(enDash)).toEqual({added: 5, removed: 3});
  });

  it('prefers an aria-label stat when present', () => {
    const container = reactContainer(`
      <h3 class="DiffFileHeader-module__file-name__a1"><code>src/foo.ts</code></h3>
      <span aria-label="58 additions, 22 deletions"><span>+58</span> <span>−22</span></span>
    `);
    expect(react.getChangedLines(container)).toEqual({added: 58, removed: 22});
  });

  it('does not mistake file names for stats', () => {
    const container = reactContainer(`
      <h3 class="DiffFileHeader-module__file-name__a1"><code>src/foo+1.ts</code></h3>
    `);
    expect(react.getChangedLines(container)).toBeNull();
  });

  it('returns null when there is nothing parseable (graceful, no poisoned totals)', () => {
    expect(react.getChangedLines(reactContainer('<span>some file</span>'))).toBeNull();
  });

  it('falls back to counting diff rows when the header has no stats', () => {
    const container = reactContainer(
      '<h3 class="DiffFileHeader-module__file-name__a1"><code>src/foo.ts</code></h3>',
      `<table>
        <tr class="diff-line-row"><td class="blob-addition">+x</td></tr>
        <tr class="diff-line-row"><td class="blob-addition">+y</td></tr>
        <tr class="diff-line-row"><td class="blob-deletion">-z</td></tr>
      </table>`,
    );
    expect(react.getChangedLines(container)).toEqual({added: 2, removed: 1});
  });
});

describe('react adapter getPath', () => {
  it('strips invisible bidi marks from the file name', () => {
    const container = reactContainer(
      '<h3 class="DiffFileHeader-module__file-name__a1"><code>\u200Esrc/foo.ts\u200F</code></h3>',
    );
    expect(react.getPath(container)).toBe('src/foo.ts');
  });

  it('uses the new path on renames', () => {
    const container = reactContainer(
      '<h3 class="DiffFileHeader-module__file-name__a1"><code>old/foo.ts → new/bar.ts</code></h3>',
    );
    expect(react.getPath(container)).toBe('new/bar.ts');
  });
});

describe('outerFileWrapper', () => {
  it('returns the container itself in the classic flat list', () => {
    document.body.innerHTML = `
      <main><div id="list">
        <div class="js-file" id="diff-a"></div>
        <div class="js-file" id="diff-b"></div>
      </div></main>`;
    const container = document.querySelector('#diff-a')!;
    expect(outerFileWrapper(container)).toBe(container);
  });

  it('climbs to the outermost single-file wrapper in the React view', () => {
    document.body.innerHTML = `
      <main><div id="list">
        <div class="row"><div class="card"><div id="diff-a"></div></div></div>
        <div class="row"><div class="card"><div id="diff-b"></div></div></div>
      </div></main>`;
    const wrapper = outerFileWrapper(document.querySelector('#diff-a')!);
    expect(wrapper.className).toBe('row');
  });

  it('stops at a virtualized list with many slot children', () => {
    document.body.innerHTML = `
      <main><div id="list">
        <div class="row">
          <div id="diff-a"></div><i></i><i></i><i></i><i></i>
        </div>
      </div></main>`;
    const container = document.querySelector('#diff-a')!;
    // row has 5 element children - could be a slot list, so no climb
    expect(outerFileWrapper(container)).toBe(container);
  });

  it('stops at an ancestor containing the file tree', () => {
    document.body.innerHTML = `
      <main><div id="layout">
        <li class="js-tree-node"></li>
        <div class="row"><div id="diff-a"></div></div>
      </div></main>`;
    const wrapper = outerFileWrapper(document.querySelector('#diff-a')!);
    expect(wrapper.className).toBe('row');
  });
});
