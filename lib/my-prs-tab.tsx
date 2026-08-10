import {browser} from 'wxt/browser';

/**
 * "My PRs" tab in the repository underline nav, cloned from GitHub's own
 * "Pull requests" tab so it inherits Primer styling/iconography. Pure URL
 * helpers are exported for unit tests; the DOM part is idempotent and
 * re-evaluates selected state on every soft navigation.
 */

export const MY_PRS_TAB_ID = 'my-prs-repo-tab';

/** The "N Open" count from a pulls-page HTML document. */
export function parseOpenPullsCount(html: string): number | null {
  for (const match of html.matchAll(/<a\b[^>]*href="[^"]*\/pulls\?[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    const text = match[1]
      .replaceAll(/<[^>]+>/g, ' ')
      .replaceAll(/&[^;]+;/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();
    const count = /^([\d,]+)\s+Open\b/.exec(text);
    if (count) {
      return Number(count[1].replaceAll(',', ''));
    }
  }

  return null;
}

/** The value of the issues/pulls search input (`name="q"`), preferring one that holds a pulls query. */
export function extractSearchQuery(html: string): string | null {
  let fallback: string | null = null;
  for (const match of html.matchAll(/<input\b[^>]*>/g)) {
    const tag = match[0];
    if (!/\bname="q"/.test(tag)) {
      continue;
    }

    const value = /\bvalue="([^"]*)"/.exec(tag);
    if (!value) {
      continue;
    }

    const decoded = value[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&');
    if (decoded.includes('is:pr')) {
      return decoded;
    }

    fallback ??= decoded;
  }

  return fallback;
}

/** The logged-in username from GitHub's meta tag; empty/absent when logged out. */
export function extractUserLogin(html: string): string | null {
  const meta = /<meta\b[^>]*name="user-login"[^>]*>/.exec(html);
  if (!meta) {
    return null;
  }

  const content = /\bcontent="([^"]*)"/.exec(meta[0]);
  return content?.[1] ? content[1] : null;
}

const COUNT_STORAGE_KEY = 'prix:myPrCounts';
const COUNT_TTL_MS = 5 * 60 * 1000;

type CountCache = Record<string, {count: number; ts: number}>;

let countsCache: CountCache | null = null;
let countsPromise: Promise<CountCache> | null = null;

/**
 * Reads the count cache into memory once. Called at document_start so a
 * cached count is available synchronously-ish by the time the nav mounts and
 * the tab is inserted - the placeholder can be filled before first paint.
 */
export function preloadMyPrCounts(): Promise<CountCache> {
  countsPromise ??= browser.storage.local
    .get(COUNT_STORAGE_KEY)
    .then(stored => {
      countsCache = (stored[COUNT_STORAGE_KEY] as CountCache | undefined) ?? {};
      return countsCache;
    })
    .catch(error => {
      console.error('[PR Impact]', 'my-prs-count-preload', error);
      countsCache = {};
      return countsCache;
    });
  return countsPromise;
}

/**
 * My open-PR count for the repo. Fresh cache hits (< 5 min) are returned
 * without a fetch; callers render stale hits immediately and only call this
 * when a refetch is due. Logged out, GitHub redirects author:@me to
 * /pulls/@me and drops the author filter - detect that and show no count.
 */
export async function fetchMyPrCount(owner: string, repo: string): Promise<number | null> {
  const key = `${owner}/${repo}`;
  try {
    const all = await preloadMyPrCounts();
    const hit = all[key];
    if (hit && Date.now() - hit.ts < COUNT_TTL_MS) {
      return hit.count;
    }

    const response = await fetch(`/${owner}/${repo}/pulls?q=is%3Apr+is%3Aopen+author%3A%40me`, {
      credentials: 'include',
    });
    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    // Logged out, author:@me can't resolve (GitHub redirects to /pulls/@me
    // and reports "0 Open") - only trust the count with a real user-login.
    if (!extractUserLogin(html) || !extractSearchQuery(html)?.includes('author:@me')) {
      return null;
    }

    const count = parseOpenPullsCount(html);
    if (count !== null) {
      all[key] = {count, ts: Date.now()};
      void browser.storage.local.set({[COUNT_STORAGE_KEY]: all});
    }

    return count;
  } catch {
    return null;
  }
}

export function buildMyPrsHref(owner: string, repo: string, author = '@me'): string {
  // author:@me resolves server-side, but GitHub 302s it to /pulls/@me, which
  // complicates selected-state detection. Logged in we know the login and
  // use it directly - deterministic, no redirect. @me stays as the fallback.
  const query = new URLSearchParams({q: `is:pr is:open author:${author}`}).toString();
  return `/${owner}/${repo}/pulls?${query}`;
}

/** The logged-in username from the current page's meta tag; null logged out. */
function currentLogin(): string | null {
  return document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null;
}

/**
 * True when the current URL is "my PRs" for this repo: either /pulls with
 * author:@me or author:<login> as a whole token of q, or the /pulls/@me
 * redirect target (which only means "mine" when logged in - logged out it
 * lists everyone's open PRs).
 */
export function isMyPrsUrl(
  owner: string,
  repo: string,
  login: string | null,
  pathname: string,
  search: string,
): boolean {
  const path = pathname.replace(/\/$/, '');
  if (path === `/${owner}/${repo}/pulls/@me`) {
    return login !== null;
  }

  if (path !== `/${owner}/${repo}/pulls`) {
    return false;
  }

  const query = new URLSearchParams(search).get('q');
  if (!query) {
    return false;
  }

  // Token comparison, not substring: `author:@meow` or `xauthor:@me` must not match
  const tokens = query.toLowerCase().split(/\s+/);
  if (tokens.includes('author:@me')) {
    return true;
  }

  return login !== null && tokens.includes(`author:${login.toLowerCase()}`);
}

/**
 * Mirrors GitHub's own selected-tab expression: `selected` class + aria-current.
 * Read-then-write: once converged, repeat calls are zero-DOM-write no-ops
 * (attribute/class writes are what cost layout on soft-nav re-evaluations).
 */
function applySelected(tab: Element, selected: boolean): void {
  if (tab.classList.contains('selected') !== selected) {
    tab.classList.toggle('selected', selected);
  }

  const hasCurrent = tab.getAttribute('aria-current') === 'page';
  if (selected && !hasCurrent) {
    tab.setAttribute('aria-current', 'page');
  } else if (!selected && hasCurrent) {
    tab.removeAttribute('aria-current');
  }

  // Primer React tabs use aria-selected instead of aria-current
  if (tab.hasAttribute('aria-selected') && tab.getAttribute('aria-selected') !== String(selected)) {
    tab.setAttribute('aria-selected', String(selected));
  }
}

/**
 * Writes the count into the tab's existing placeholder span, in place, only
 * when the text actually changed. The node is never swapped or removed, so
 * the counter can never cause a layout shift (geometry is reserved in CSS).
 */
function renderCount(tab: Element, count: number): void {
  const counter = tab.querySelector<HTMLElement>('.prix-counter');
  const text = String(count);
  if (counter && counter.textContent !== text) {
    counter.textContent = text;
    counter.title = `${count} open PR${count === 1 ? '' : 's'} by you`;
  }
}

export function ensureMyPrsTab(): void {
  try {
    ensureMyPrsTabUnsafe();
  } catch (error) {
    console.error('[PR Impact]', 'my-prs-tab', error);
  }
}

function ensureMyPrsTabUnsafe(): void {
  const [owner, repo] = location.pathname.split('/').filter(Boolean);
  if (!owner || !repo) {
    return;
  }

  // Live GitHub uses #pull-requests-tab; #pull-requests-repo-tab is the older id
  const pullsTab =
    document.querySelector('a#pull-requests-tab, a#pull-requests-repo-tab') ??
    document.querySelector('nav[aria-label="Repository"] a[href$="/pulls"]');
  if (!pullsTab) {
    // PRs disabled, or nav not rendered yet - stay out of the way
    return;
  }

  const login = currentLogin();
  const href = buildMyPrsHref(owner, repo, login ?? '@me');
  const existing = document.getElementById(MY_PRS_TAB_ID);

  if (!existing) {
    const item = pullsTab.closest('li');
    if (!item) {
      return;
    }

    const clone = item.cloneNode(true) as HTMLElement;
    const link = clone.querySelector('a');
    if (!link) {
      return;
    }

    link.id = MY_PRS_TAB_ID;
    link.setAttribute('href', href);
    // Detach from GitHub's own selected-tab machinery (it would mark the clone
    // selected on every /pulls/* page) - selected state is managed below
    link.removeAttribute('data-selected-links');
    link.classList.remove('js-selected-navigation-item');

    // We have no count for "My PRs" - drop the cloned Counter rather than fake one
    for (const counter of clone.querySelectorAll('.Counter, [class*="Counter"]')) {
      counter.remove();
    }

    // Take the PR tab's CURRENT icon (same page, same render) rather than
    // trusting whatever the clone captured - nav markup variants drift
    const currentIcon = pullsTab.querySelector('svg');
    const clonedIcon = link.querySelector('svg');
    if (currentIcon && clonedIcon) {
      clonedIcon.replaceWith(currentIcon.cloneNode(true));
    }

    // Label replacement touches only the label span, never the icon
    const label =
      link.querySelector('span[data-content]') ??
      [...link.querySelectorAll('span')].find(span => span.textContent?.trim() && !span.querySelector('svg'));
    if (label) {
      label.textContent = 'My PRs';
      label.setAttribute('data-content', 'My PRs');
    }

    applySelected(link, false);

    // Counter placeholder is part of the initial insert: its geometry is
    // reserved in CSS, so a count arriving later changes text only, never
    // layout. Fill it from the (preloaded) cache immediately when available.
    const counter = document.createElement('span');
    counter.className = 'Counter prix-counter';
    link.append(counter);

    item.after(clone);

    const cached = countsCache?.[`${owner}/${repo}`];
    if (cached) {
      renderCount(link, cached.count);
    }
  } else {
    // Invariant repairs on an existing tab, each convergent (no write when correct):
    // correct href (login became known, or repo changed under a persistent nav)...
    if (existing.getAttribute('href') !== href) {
      existing.setAttribute('href', href);
    }

    // ...and position: GitHub re-renders can orphan or reorder our li
    const prsItem = pullsTab.closest('li');
    const myItem = existing.closest('li');
    if (prsItem && myItem && prsItem.nextElementSibling !== myItem) {
      prsItem.after(myItem);
    }
  }

  const myTab = document.getElementById(MY_PRS_TAB_ID);
  if (!myTab) {
    return;
  }

  // Refresh the count in the background only when missing or stale; the
  // cached value (however old) was already rendered at insert time.
  const hit = countsCache?.[`${owner}/${repo}`];
  if (!hit || Date.now() - hit.ts > COUNT_TTL_MS) {
    void fetchMyPrCount(owner, repo)
      .then(count => {
        try {
          if (count === null) {
            return; // logged out / fetch failed - placeholder stays empty
          }

          const tab = document.getElementById(MY_PRS_TAB_ID);
          if (tab) {
            renderCount(tab, count);
          }
        } catch (error) {
          console.error('[PR Impact]', 'my-prs-count', error);
        }
      })
      .catch(error => {
        console.error('[PR Impact]', 'my-prs-count', error);
      });
  }

  const active = isMyPrsUrl(owner, repo, login, location.pathname, location.search);
  applySelected(myTab, active);
  if (active) {
    applySelected(pullsTab, false);
  }
}

/**
 * Persistent invariant watcher: on every DOM mutation batch, if a Pull
 * requests tab exists, our tab must sit immediately after it with the right
 * href and selected state. GitHub re-renders the nav subtree (deferred turbo
 * frames, React partials) and can drop or reorder our clone without producing
 * a fresh #pull-requests-tab node, so a seen-once selector observer is not
 * enough. ensureMyPrsTab converges - when the invariant holds this is a
 * couple of id lookups and zero DOM writes.
 */
export function watchMyPrsTab(signal: AbortSignal): void {
  const observer = new MutationObserver(() => {
    ensureMyPrsTab();
  });
  observer.observe(document.documentElement, {childList: true, subtree: true});
  signal.addEventListener(
    'abort',
    () => {
      observer.disconnect();
    },
    {once: true},
  );
}
