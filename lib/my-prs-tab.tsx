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

/**
 * My open-PR count for the repo, cached in chrome.storage.local for ~5 min.
 * Logged out, GitHub redirects author:@me to /pulls/@me and drops the author
 * filter — detect that via the rendered search query and show no count.
 */
export async function fetchMyPrCount(owner: string, repo: string): Promise<number | null> {
  const key = `${owner}/${repo}`;
  try {
    const stored = await browser.storage.local.get(COUNT_STORAGE_KEY);
    const all: Record<string, {count: number; ts: number}> =
      (stored[COUNT_STORAGE_KEY] as Record<string, {count: number; ts: number}> | undefined) ?? {};
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
    // and reports "0 Open") — only trust the count with a real user-login.
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

export function buildMyPrsHref(owner: string, repo: string): string {
  // author:@me resolves to the logged-in user server-side, no username needed
  const query = new URLSearchParams({q: 'is:pr is:open author:@me'}).toString();
  return `/${owner}/${repo}/pulls?${query}`;
}

/** True only when on the repo's /pulls page with `author:@me` as a whole token of `q`. */
export function isMyPrsUrl(owner: string, repo: string, pathname: string, search: string): boolean {
  if (pathname.replace(/\/$/, '') !== `/${owner}/${repo}/pulls`) {
    return false;
  }

  const query = new URLSearchParams(search).get('q');
  if (!query) {
    return false;
  }

  // Token comparison, not substring: `author:@meow` or `xauthor:@me` must not match
  return query.split(/\s+/).includes('author:@me');
}

/** Mirrors GitHub's own selected-tab expression: `selected` class + aria-current. */
function applySelected(tab: Element, selected: boolean): void {
  tab.classList.toggle('selected', selected);
  if (selected) {
    tab.setAttribute('aria-current', 'page');
  } else {
    tab.removeAttribute('aria-current');
  }

  // Primer React tabs use aria-selected instead of aria-current
  if (tab.hasAttribute('aria-selected')) {
    tab.setAttribute('aria-selected', String(selected));
  }
}

export function ensureMyPrsTab(): void {
  const [owner, repo] = location.pathname.split('/').filter(Boolean);
  if (!owner || !repo) {
    return;
  }

  // Live GitHub uses #pull-requests-tab; #pull-requests-repo-tab is the older id
  const pullsTab =
    document.querySelector('a#pull-requests-tab, a#pull-requests-repo-tab') ??
    document.querySelector('nav[aria-label="Repository"] a[href$="/pulls"]');
  if (!pullsTab) {
    // PRs disabled, or nav not rendered yet — stay out of the way
    return;
  }

  if (!document.getElementById(MY_PRS_TAB_ID)) {
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
    link.setAttribute('href', buildMyPrsHref(owner, repo));
    // Detach from GitHub's own selected-tab machinery (it would mark the clone
    // selected on every /pulls/* page) — selected state is managed below
    link.removeAttribute('data-selected-links');
    link.classList.remove('js-selected-navigation-item');

    // We have no count for "My PRs" — drop the cloned Counter rather than fake one
    for (const counter of clone.querySelectorAll('.Counter, [class*="Counter"]')) {
      counter.remove();
    }

    const label =
      link.querySelector('span[data-content]') ??
      [...link.querySelectorAll('span')].find(span => span.textContent?.trim());
    if (label) {
      label.textContent = 'My PRs';
      label.setAttribute('data-content', 'My PRs');
    }

    applySelected(link, false);
    item.after(clone);
  }

  const myTab = document.getElementById(MY_PRS_TAB_ID);
  if (!myTab) {
    return;
  }

  // Open-PR count badge (async; silently absent logged out or on fetch failure)
  void fetchMyPrCount(owner, repo).then(count => {
    const tab = document.getElementById(MY_PRS_TAB_ID);
    if (count === null || !tab || tab.querySelector('.prix-counter')) {
      return;
    }

    const counter = document.createElement('span');
    counter.className = 'Counter prix-counter';
    counter.textContent = String(count);
    counter.title = `${count} open PR${count === 1 ? '' : 's'} by you`;
    tab.append(counter);
  });

  const active = isMyPrsUrl(owner, repo, location.pathname, location.search);
  applySelected(myTab, active);
  if (active) {
    applySelected(pullsTab, false);
  }
}
