import {browser} from 'wxt/browser';

/**
 * Custom repo-nav tabs ("My PRs", "Review requested"), cloned from GitHub's
 * own "Pull requests" tab so they inherit Primer styling. Both are driven off
 * one definition table; the pure helpers (URL builders, detectors, parsers)
 * stay exported for unit tests. The DOM part is idempotent, convergent, and
 * self-repairs after GitHub re-renders the nav.
 */

export interface TabDefinition {
  id: string;
  label: string;
  /** The pulls-search qualifier: author:<x> or review-requested:<x>. */
  qualifier: 'author' | 'review-requested';
  /** Where GitHub 302s the @me query form. Only "mine" when logged in. */
  atMePath: string;
  /** Accent-filled counter ("yours") vs GitHub's default grey. */
  accentCounter: boolean;
  /** Counter tooltip, given the count. */
  counterTitle: (count: number) => string;
}

export const PULL_TABS: TabDefinition[] = [
  {
    id: 'my-prs-repo-tab',
    label: 'My PRs',
    qualifier: 'author',
    atMePath: 'pulls/@me',
    accentCounter: true,
    counterTitle: count => `${count} open PR${count === 1 ? '' : 's'} by you`,
  },
  {
    id: 'review-requested-repo-tab',
    label: 'Review requested',
    qualifier: 'review-requested',
    atMePath: 'pulls/review-requested/@me',
    accentCounter: false,
    counterTitle: count => `${count} open PR${count === 1 ? '' : 's'} awaiting your review`,
  },
];

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

const COUNT_STORAGE_KEY = 'prix:pullsCounts';
const COUNT_TTL_MS = 5 * 60 * 1000;

type CountCache = Record<string, {count: number; ts: number}>;

let countsCache: CountCache | null = null;
let countsPromise: Promise<CountCache> | null = null;

// Fetch attempts by cache key, so a logged-out/failed fetch doesn't retry on
// every mutation batch (the watcher re-runs constantly by design).
const fetchAttempts = new Map<string, number>();

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
      console.warn('[PR Impact]', 'pulls-count-preload', error);
      countsCache = {};
      return countsCache;
    });
  return countsPromise;
}

const countKey = (owner: string, repo: string, def: TabDefinition): string =>
  `${owner}/${repo}:${def.qualifier}`;

/**
 * Open-PR count for one tab. Fresh cache hits (< 5 min) skip the fetch; a
 * failed fetch isn't retried inside the TTL window (stale cache still wins).
 * Logged out, GitHub redirects @me queries and the result isn't "mine" -
 * detect that via the user-login meta and show no count.
 */
export async function fetchPullsCount(
  owner: string,
  repo: string,
  def: TabDefinition,
  value: string,
): Promise<number | null> {
  const key = countKey(owner, repo, def);
  try {
    const all = await preloadMyPrCounts();
    const hit = all[key];
    if (hit && Date.now() - hit.ts < COUNT_TTL_MS) {
      return hit.count;
    }

    const lastAttempt = fetchAttempts.get(key) ?? 0;
    if (Date.now() - lastAttempt < COUNT_TTL_MS) {
      return hit?.count ?? null;
    }

    fetchAttempts.set(key, Date.now());

    const query = new URLSearchParams({q: `is:pr is:open ${def.qualifier}:${value}`}).toString();
    const response = await fetch(`/${owner}/${repo}/pulls?${query}`, {credentials: 'include'});
    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    // Logged out, @me can't resolve (GitHub redirects and reports nonsense) -
    // only trust the count with a real user-login and our filter intact.
    if (!extractUserLogin(html) || !extractSearchQuery(html)?.includes(`${def.qualifier}:${value}`)) {
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

export function buildPullsHref(owner: string, repo: string, qualifier: string, value: string): string {
  const query = new URLSearchParams({q: `is:pr is:open ${qualifier}:${value}`}).toString();
  return `/${owner}/${repo}/pulls?${query}`;
}

export function buildMyPrsHref(owner: string, repo: string, author = '@me'): string {
  // author:@me resolves server-side, but GitHub 302s it to /pulls/@me, which
  // complicates selected-state detection. Logged in we know the login and
  // use it directly - deterministic, no redirect. @me stays as the fallback.
  return buildPullsHref(owner, repo, 'author', author);
}

/** The logged-in username from the current page's meta tag; null logged out. */
function currentLogin(): string | null {
  return document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null;
}

/**
 * True when the current URL belongs to this tab: the repo's /pulls page with
 * the qualifier as a whole token of q (either @me or the login), or the @me
 * redirect target path (which only means "mine" when logged in - logged out
 * it lists everyone's PRs).
 */
export function isTabActive(
  def: TabDefinition,
  owner: string,
  repo: string,
  login: string | null,
  pathname: string,
  search: string,
): boolean {
  const path = pathname.replace(/\/$/, '');
  if (path === `/${owner}/${repo}/${def.atMePath}`) {
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
  if (tokens.includes(`${def.qualifier}:@me`)) {
    return true;
  }

  return login !== null && tokens.includes(`${def.qualifier}:${login.toLowerCase()}`);
}

export function isMyPrsUrl(
  owner: string,
  repo: string,
  login: string | null,
  pathname: string,
  search: string,
): boolean {
  return isTabActive(PULL_TABS[0], owner, repo, login, pathname, search);
}

/** At most one custom tab is active; table order wins if a query somehow matches both. */
export function activePullsTabId(
  owner: string,
  repo: string,
  login: string | null,
  pathname: string,
  search: string,
): string | null {
  for (const def of PULL_TABS) {
    if (isTabActive(def, owner, repo, login, pathname, search)) {
      return def.id;
    }
  }

  return null;
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
function renderCount(tab: Element, count: number, title: string): void {
  const counter = tab.querySelector<HTMLElement>('.prix-tab-counter');
  const text = String(count);
  if (counter && counter.textContent !== text) {
    counter.textContent = text;
    counter.title = title;
  }
}

export function ensureMyPrsTab(): void {
  try {
    ensureMyPrsTabUnsafe();
  } catch (error) {
    console.warn('[PR Impact]', 'pulls-tabs', error);
  }
}

/** Inserts/repairs one tab after its predecessor, then keeps its count fresh. */
function ensureTab(
  def: TabDefinition,
  predecessor: Element,
  pullsTab: Element,
  owner: string,
  repo: string,
  login: string | null,
): void {
  const href = buildPullsHref(owner, repo, def.qualifier, login ?? '@me');
  const existing = document.getElementById(def.id);

  if (!existing) {
    const item = predecessor.closest('li');
    if (!item) {
      return;
    }

    const clone = item.cloneNode(true) as HTMLElement;
    const link = clone.querySelector('a');
    if (!link) {
      return;
    }

    link.id = def.id;
    link.setAttribute('href', href);
    // Detach from GitHub's own selected-tab machinery (it would mark the clone
    // selected on every /pulls/* page) - selected state is managed below
    link.removeAttribute('data-selected-links');
    link.classList.remove('js-selected-navigation-item');

    // We fetch our own count - drop the cloned Counter rather than fake one
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
      label.textContent = def.label;
      label.setAttribute('data-content', def.label);
    }

    applySelected(link, false);

    // Counter placeholder is part of the initial insert: its geometry is
    // reserved in CSS, so a count arriving later changes text only, never
    // layout. Fill it from the (preloaded) cache immediately when available.
    const counter = document.createElement('span');
    counter.className = `Counter prix-tab-counter${def.accentCounter ? ' prix-tab-counter--accent' : ''}`;
    link.append(counter);

    item.after(clone);

    const cached = countsCache?.[countKey(owner, repo, def)];
    if (cached) {
      renderCount(link, cached.count, def.counterTitle(cached.count));
    }
  } else {
    // Invariant repairs on an existing tab, each convergent (no write when correct):
    // correct href (login became known, or repo changed under a persistent nav)...
    if (existing.getAttribute('href') !== href) {
      existing.setAttribute('href', href);
    }

    // ...and position: GitHub re-renders can orphan or reorder our li
    const previousItem = predecessor.closest('li');
    const myItem = existing.closest('li');
    if (previousItem && myItem && previousItem.nextElementSibling !== myItem) {
      previousItem.after(myItem);
    }
  }

  // Refresh the count in the background only when missing or stale; the
  // cached value (however old) was already rendered at insert time.
  const hit = countsCache?.[countKey(owner, repo, def)];
  if (!hit || Date.now() - hit.ts > COUNT_TTL_MS) {
    void fetchPullsCount(owner, repo, def, login ?? '@me')
      .then(count => {
        try {
          if (count === null) {
            return; // logged out / fetch failed - placeholder stays empty
          }

          const tab = document.getElementById(def.id);
          if (tab) {
            renderCount(tab, count, def.counterTitle(count));
          }
        } catch (error) {
          console.warn('[PR Impact]', 'pulls-count', error);
        }
      })
      .catch(error => {
        console.warn('[PR Impact]', 'pulls-count', error);
      });
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

  // Order: Pull requests, My PRs, Review requested. A failed insert keeps the
  // predecessor chain intact so a later pass can still land everything.
  let predecessor: Element = pullsTab;
  for (const def of PULL_TABS) {
    ensureTab(def, predecessor, pullsTab, owner, repo, login);
    predecessor = document.getElementById(def.id) ?? predecessor;
  }

  const activeId = activePullsTabId(owner, repo, login, location.pathname, location.search);
  for (const def of PULL_TABS) {
    const tab = document.getElementById(def.id);
    if (tab) {
      applySelected(tab, def.id === activeId);
    }
  }

  if (activeId) {
    applySelected(pullsTab, false);
  }
}

/**
 * Persistent invariant watcher, two halves:
 *
 * 1. A childList observer on the document: GitHub re-renders the nav subtree
 *    (deferred turbo frames, React partials) and can drop or reorder our
 *    clones, so the invariant is re-checked on every mutation batch.
 * 2. An attributes observer ON THE NAV: GitHub's selected-navigation
 *    machinery re-asserts the Pull requests tab's selected state via class /
 *    aria-current flips that never produce childList mutations. Without this
 *    the tab loses the underline after hydration (the live bug). Scoped to
 *    the nav + an attribute filter so the rest of the page's attribute churn
 *    doesn't reach us, and re-attached whenever the nav node is replaced.
 *
 * ensureMyPrsTab converges, so when the invariant holds this costs a couple
 * of id lookups and zero DOM writes.
 */
export function watchMyPrsTab(signal: AbortSignal): void {
  let attributeTarget: Element | null = null;
  const attributeObserver = new MutationObserver(() => {
    ensureMyPrsTab();
  });

  const syncAttributeObserver = (): void => {
    const nav =
      document.querySelector('nav[aria-label="Repository"]') ??
      document.querySelector('a#pull-requests-tab, a#pull-requests-repo-tab')?.closest('ul') ??
      null;
    if (nav === attributeTarget) {
      return;
    }

    attributeObserver.disconnect();
    attributeTarget = nav;
    if (nav) {
      attributeObserver.observe(nav, {
        attributes: true,
        attributeFilter: ['class', 'aria-current', 'aria-selected'],
        subtree: true,
      });
    }
  };

  syncAttributeObserver();

  const childObserver = new MutationObserver(() => {
    ensureMyPrsTab();
    syncAttributeObserver();
  });
  childObserver.observe(document.documentElement, {childList: true, subtree: true});
  signal.addEventListener(
    'abort',
    () => {
      childObserver.disconnect();
      attributeObserver.disconnect();
    },
    {once: true},
  );
}
