// @vitest-environment jsdom
import {describe, expect, it} from 'vitest';
import {pullHeaderPlacement, readPrTotals} from './pr-page';

describe('native PR summary', () => {
  it('reads current GitHub totals before any diff mounts', () => {
    document.body.innerHTML = `<main><header class="PageLayout-Header-live"><nav aria-label="Pull request navigation"><a href="/owner/repo/pull/3/files"><span>icon</span>Files changed <span data-component="CounterLabel">1,024</span><span> (1,024)</span></a></nav><span class="sr-only">Lines changed: 76,258 additions &amp; 8,063 deletions</span></header><article>Conversation</article></main>`;
    expect(readPrTotals(document)).toEqual({files: 1024, added: 76258, removed: 8063});
    expect(pullHeaderPlacement()?.before).toBe(document.querySelector('article'));
  });
  it('does not invent zero totals while GitHub is loading', () => {
    document.body.innerHTML =
      '<nav aria-label="Pull request navigation"><a href="/o/r/pull/1/files">Files changed</a></nav>';
    expect(readPrTotals(document)).toBeNull();
  });
  it('prefers the tab bar over an earlier classic title header', () => {
    document.body.innerHTML =
      '<main><div id="partial-discussion-header">Title</div><nav class="tabnav-pr"><a href="/o/r/pull/1/files"><span class="Counter">3</span></a></nav><article>Conversation</article></main>';
    expect(pullHeaderPlacement()?.before).toBe(document.querySelector('article'));
  });
});
