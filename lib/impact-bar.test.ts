// @vitest-environment jsdom
import {describe, expect, it} from 'vitest';
import {findBarPlacement, ImpactBar, spanningBarPlacement} from './impact-bar';

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

describe('ImpactBar markup', () => {
  const handlers = {onCycle() {}, onExpandAll() {}, onCollapseAll() {}, onCopy() {}, onJump() {}};

  it('renders header, track and legend rows in order', () => {
    const bar = new ImpactBar(['tests', 'code'], handlers);
    const children = [...bar.element.children].map(el => el.className);
    expect(children).toEqual(['prix-bar-header', 'prix-bar-track', 'prix-bar-legend', 'prix-chart']);
    expect(bar.element.querySelector('.prix-bar-title')?.textContent).toBe('Impact');
    expect(bar.element.querySelector('.prix-bar-header .prix-totals')).not.toBeNull();
  });

  it('chips carry the category colour as a custom property', () => {
    const bar = new ImpactBar(['tests', 'code'], handlers);
    const chip = bar.element.querySelector<HTMLElement>('.prix-chip[data-category="tests"]')!;
    expect(chip.style.getPropertyValue('--prix-cat')).toContain('accent-emphasis');
    const codeChip = bar.element.querySelector<HTMLElement>('.prix-chip[data-category="code"]')!;
    expect(codeChip.style.getPropertyValue('--prix-cat')).toContain('neutral-emphasis');
  });

  it('chips show name and percentage only, with state in the aria-label', () => {
    const bar = new ImpactBar(['tests', 'code'], handlers);
    bar.update(
      new Map([
        ['tests', {files: 1, added: 35, removed: 0, reviewed: 0}],
        ['code', {files: 1, added: 35, removed: 0, reviewed: 0}],
      ]),
      () => 'visible',
    );
    const chip = bar.element.querySelector<HTMLElement>('.prix-chip[data-category="tests"]')!;
    expect(chip.querySelector('.prix-chip-meta')?.textContent).toBe('50%');
    expect(chip.getAttribute('aria-label')).toBe('tests, 50%, visible - click to collapse');
    expect(chip.title).toContain('1 file · 35 lines · 50%');
    expect(chip.title).toContain('click to cycle');
  });

  it('aria-label follows the state', () => {
    const bar = new ImpactBar(['tests'], handlers);
    const counts = new Map([['tests', {files: 1, added: 5, removed: 5, reviewed: 0}]]);
    bar.update(counts, () => 'collapsed');
    const chip = bar.element.querySelector('.prix-chip[data-category="tests"]')!;
    expect(chip.getAttribute('aria-label')).toBe('tests, 100%, collapsed - click to hide');
    bar.update(counts, () => 'hidden');
    expect(chip.getAttribute('aria-label')).toBe('tests, 100%, hidden - click to show');
  });
});

describe('findBarPlacement above the React PR page', () => {
  it('lands at the top of the files region when a block ancestor exists there', () => {
    document.body.innerHTML = `
      <main>
        <div id="page" style="display: flex">
          <div id="header"><a href="/o/r/pull/1/commits">Commits</a></div>
          <div id="region">
            <div id="row" style="display: flex"><div id="diff-a"></div></div>
          </div>
        </div>
      </main>`;
    const placement = findBarPlacement(document.querySelector('#diff-a')!)!;
    expect(placement.parent).toBe(document.querySelector('#region'));
    expect(placement.before).toBe(document.querySelector('#row'));
  });

  it('refuses to climb above the PR header when everything below is flex', () => {
    document.body.innerHTML = `
      <main>
        <div id="page">
          <div id="header"><a href="/o/r/pull/1/commits">Commits</a></div>
          <div id="row" style="display: flex">
            <div id="viewer" style="display: flex"><div id="diff-a"></div></div>
          </div>
        </div>
      </main>`;
    // #page is block but holds the PR header - too far. Null, not a full-bleed bar.
    expect(findBarPlacement(document.querySelector('#diff-a')!)).toBeNull();
  });
});

describe('spanningBarPlacement', () => {
  it('spans all tracks when the anchor parent is grid', () => {
    document.body.innerHTML = `
      <main>
        <div id="grid" style="display: grid"><div id="diff-a"></div></div>
      </main>`;
    const bar = document.createElement('div');
    const placement = spanningBarPlacement(document.querySelector('#diff-a')!, bar)!;
    expect(placement.parent).toBe(document.querySelector('#grid'));
    expect(placement.before).toBe(document.querySelector('#diff-a'));
    expect(bar.style.gridColumn).toBe('1 / -1');
  });

  it('takes a full row when the anchor parent is wrapping flex', () => {
    document.body.innerHTML = `
      <main>
        <div id="row" style="display: flex; flex-wrap: wrap"><div id="diff-a"></div></div>
      </main>`;
    const bar = document.createElement('div');
    const placement = spanningBarPlacement(document.querySelector('#diff-a')!, bar)!;
    expect(placement.parent).toBe(document.querySelector('#row'));
    expect(bar.style.flex).toBe('0 0 100%');
  });

  it('climbs out of a nowrap flex row into a spannable ancestor', () => {
    // Live on the React files view (langwatch#6894): file containers sit
    // under nowrap flex rows, with a grid layout further up
    document.body.innerHTML = `
      <main>
        <div id="grid" style="display: grid">
          <div id="row" style="display: flex; flex-wrap: nowrap">
            <div id="viewer" style="display: flex; flex-wrap: nowrap"><div id="diff-a"></div></div>
          </div>
        </div>
      </main>`;
    const bar = document.createElement('div');
    const placement = spanningBarPlacement(document.querySelector('#diff-a')!, bar)!;
    expect(placement.parent).toBe(document.querySelector('#grid'));
    expect(placement.before).toBe(document.querySelector('#row'));
    expect(bar.style.gridColumn).toBe('1 / -1');
  });

  it('takes a full row of a wrapping flex ancestor above nowrap levels', () => {
    document.body.innerHTML = `
      <main>
        <div id="row" style="display: flex; flex-wrap: wrap">
          <div id="inner" style="display: flex; flex-wrap: nowrap"><div id="diff-a"></div></div>
        </div>
      </main>`;
    const bar = document.createElement('div');
    const placement = spanningBarPlacement(document.querySelector('#diff-a')!, bar)!;
    expect(placement.parent).toBe(document.querySelector('#row'));
    expect(placement.before).toBe(document.querySelector('#inner'));
    expect(bar.style.flex).toBe('0 0 100%');
  });

  it('refuses when nowrap flex is all there is below <main>', () => {
    document.body.innerHTML = `
      <main>
        <div style="display: flex; flex-wrap: nowrap"><div id="diff-a"></div></div>
      </main>`;
    const bar = document.createElement('div');
    expect(spanningBarPlacement(document.querySelector('#diff-a')!, bar)).toBeNull();
    expect(bar.style.flex).toBe('');
  });

  it('refuses a parent that also holds the PR header', () => {
    document.body.innerHTML = `
      <main>
        <div id="page">
          <a href="/o/r/pull/1/commits">Commits</a>
          <div id="diff-a"></div>
        </div>
      </main>`;
    expect(spanningBarPlacement(document.querySelector('#diff-a')!, document.createElement('div'))).toBeNull();
  });
});
