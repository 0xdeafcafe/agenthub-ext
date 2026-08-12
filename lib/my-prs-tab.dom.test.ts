// @vitest-environment jsdom
import {beforeEach, describe, expect, it} from 'vitest';
import {ensureMyPrsTab, watchMyPrsTab} from './my-prs-tab';

const NAV = `
  <nav aria-label="Repository"><ul>
    <li><a id="pull-requests-tab" href="/octo/hello/pulls"><svg viewBox="0 0 16 16"><path d="M1"/></svg><span data-content="Pull requests">Pull requests</span><span class="Counter">224</span></a></li>
    <li><a id="actions-tab" href="/octo/hello/actions"><span data-content="Actions">Actions</span></a></li>
  </ul></nav>`;

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.innerHTML = NAV;
  history.replaceState(null, '', '/octo/hello');
});

describe('custom pulls tabs', () => {
  it('inserts My PRs and Review requested in order after Pull requests', () => {
    ensureMyPrsTab();
    const items = [...document.querySelectorAll('nav[aria-label="Repository"] li a')].map(a => a.id || a.textContent);
    expect(items).toEqual([
      'pull-requests-tab',
      'my-prs-repo-tab',
      'review-requested-repo-tab',
      'actions-tab',
    ]);
    expect(document.querySelector('#my-prs-repo-tab span[data-content]')?.textContent).toBe('My PRs');
    expect(document.querySelector('#review-requested-repo-tab span[data-content]')?.textContent).toBe(
      'Review requested',
    );
  });

  it('builds @me hrefs when logged out and keeps counters as empty placeholders', () => {
    ensureMyPrsTab();
    expect(document.getElementById('my-prs-repo-tab')?.getAttribute('href')).toBe(
      '/octo/hello/pulls?q=is%3Apr+is%3Aopen+author%3A%40me',
    );
    expect(document.getElementById('review-requested-repo-tab')?.getAttribute('href')).toBe(
      '/octo/hello/pulls?q=is%3Apr+is%3Aopen+review-requested%3A%40me',
    );
    const mine = document.querySelector('#my-prs-repo-tab .prix-tab-counter');
    const review = document.querySelector('#review-requested-repo-tab .prix-tab-counter');
    expect(mine?.classList.contains('prix-tab-counter--accent')).toBe(true);
    expect(review?.classList.contains('prix-tab-counter--accent')).toBe(false);
    expect(mine?.textContent).toBe('');
    expect(review?.textContent).toBe('');
  });

  it('drops the cloned counter and copies the current icon', () => {
    ensureMyPrsTab();
    const mine = document.getElementById('my-prs-repo-tab')!;
    expect(mine.querySelectorAll('.Counter').length).toBe(1); // our placeholder only
    expect(mine.querySelector('svg')?.outerHTML).toBe(
      document.querySelector('#pull-requests-tab svg')?.outerHTML,
    );
  });

  it('marks My PRs selected on its URL and deselects the GitHub tab', () => {
    history.replaceState(null, '', '/octo/hello/pulls?q=is:pr is:open author:@me');
    ensureMyPrsTab();
    expect(document.getElementById('my-prs-repo-tab')?.getAttribute('aria-current')).toBe('page');
    expect(document.getElementById('review-requested-repo-tab')?.getAttribute('aria-current')).toBeNull();
    expect(document.getElementById('pull-requests-tab')?.getAttribute('aria-current')).toBeNull();
  });

  it('marks Review requested selected on its URL, never both', () => {
    history.replaceState(null, '', '/octo/hello/pulls?q=is:pr is:open review-requested:@me');
    ensureMyPrsTab();
    expect(document.getElementById('review-requested-repo-tab')?.getAttribute('aria-current')).toBe('page');
    expect(document.getElementById('my-prs-repo-tab')?.getAttribute('aria-current')).toBeNull();
  });

  it('re-inserts a tab GitHub dropped, in the right position', async () => {
    ensureMyPrsTab();
    const controller = new AbortController();
    watchMyPrsTab(controller.signal);
    await flush();

    document.getElementById('review-requested-repo-tab')?.closest('li')?.remove();
    expect(document.getElementById('review-requested-repo-tab')).toBeNull();
    await flush();

    const mine = document.getElementById('my-prs-repo-tab')!;
    const review = document.getElementById('review-requested-repo-tab');
    expect(review).not.toBeNull();
    expect(mine.closest('li')?.nextElementSibling).toBe(review?.closest('li'));
    controller.abort();
  });

  it('regression: re-applies selected state after GitHub re-asserts its tab via attributes', async () => {
    history.replaceState(null, '', '/octo/hello/pulls?q=is:pr is:open author:@me');
    ensureMyPrsTab();
    const controller = new AbortController();
    watchMyPrsTab(controller.signal);
    await flush(); // childList callback attaches the attribute observer to the nav

    // GitHub's selected-navigation machinery reclaims the underline with
    // attribute flips only - no childList mutations
    const prs = document.getElementById('pull-requests-tab')!;
    const mine = document.getElementById('my-prs-repo-tab')!;
    prs.setAttribute('aria-current', 'page');
    prs.classList.add('selected');
    mine.removeAttribute('aria-current');
    mine.classList.remove('selected');
    await flush();

    expect(mine.getAttribute('aria-current')).toBe('page');
    expect(mine.classList.contains('selected')).toBe(true);
    expect(prs.getAttribute('aria-current')).toBeNull();
    expect(prs.classList.contains('selected')).toBe(false);
    controller.abort();
  });
});
