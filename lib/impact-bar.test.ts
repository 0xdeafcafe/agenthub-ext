// @vitest-environment jsdom
import {describe, expect, it} from 'vitest';
import {findBarPlacement} from './impact-bar';

describe('findBarPlacement', () => {
  it('places directly before the anchor in a block parent', () => {
    document.body.innerHTML = '<main><div id="wrap"><div id="file"></div></div></main>';
    const placement = findBarPlacement(document.querySelector('#file')!)!;
    expect(placement.parent).toBe(document.querySelector('#wrap'));
    expect(placement.before).toBe(document.querySelector('#file'));
  });

  it('climbs out of a flex row instead of becoming a column', () => {
    // The live React-files-view bug: bar inserted as a flex child became
    // its own column next to the tree and diff panes
    document.body.innerHTML = `
      <main>
        <div id="page" style="display: block">
          <div id="row" style="display: flex">
            <div id="viewer" style="display: flex">
              <div id="diff-abc"></div>
            </div>
          </div>
        </div>
      </main>`;
    const placement = findBarPlacement(document.querySelector('#diff-abc')!)!;
    expect(placement.parent).toBe(document.querySelector('#page'));
    expect(placement.before).toBe(document.querySelector('#row'));
  });

  it('climbs out of grid containers too', () => {
    document.body.innerHTML = `
      <main>
        <div id="page">
          <div id="grid" style="display: grid"><div id="diff-abc"></div></div>
        </div>
      </main>`;
    const placement = findBarPlacement(document.querySelector('#diff-abc')!)!;
    expect(placement.parent).toBe(document.querySelector('#page'));
    expect(placement.before).toBe(document.querySelector('#grid'));
  });

  it('refuses when nothing block-level exists before <main>', () => {
    document.body.innerHTML = `
      <main>
        <div style="display: flex"><div id="diff-abc"></div></div>
      </main>`;
    expect(findBarPlacement(document.querySelector('#diff-abc')!)).toBeNull();
  });
});
