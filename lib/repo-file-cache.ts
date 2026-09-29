import {browser} from 'wxt/browser';

interface CachedFile {
  text: string;
  ts: number;
}

const STORAGE_KEY = 'prix:repoFiles';
const MAX_ENTRIES = 300;
const DEFAULT_BRANCH_TTL_MS = 10 * 60 * 1000;

export function repoFileCacheKey(owner: string, repo: string, ref: string, path: string): string {
  return `${owner}/${repo}@${ref}#${path}`;
}

/** LRU trim: keep the newest `max` entries by timestamp. Pure. */
export function trimRepoFileCache(
  record: Record<string, CachedFile>,
  max = MAX_ENTRIES,
): Record<string, CachedFile> {
  const keys = Object.keys(record);
  if (keys.length <= max) return record;

  const byAge = keys.sort((a, b) => record[b].ts - record[a].ts);
  return Object.fromEntries(byAge.slice(0, max).map((key) => [key, record[key]]));
}

/**
 * Persists fetched repo file content (`.gitattributes`, `pr-impact.yml`)
 * across page loads and browser restarts - re-fetching these on every PR
 * visit was the main source of slow detection.
 *
 * An exact commit SHA is content-addressed and immutable, so it's cached
 * forever. `HEAD` (the default branch) can move, so it gets a short TTL
 * instead. A miss (including a 404, cached as an empty string) returns
 * `null` so the caller knows to fetch.
 */
export async function readCachedFile(
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<string | null> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const record = (stored[STORAGE_KEY] as Record<string, CachedFile> | undefined) ?? {};
    const entry = record[repoFileCacheKey(owner, repo, ref, path)];
    if (!entry) return null;
    if (ref === 'HEAD' && Date.now() - entry.ts > DEFAULT_BRANCH_TTL_MS) return null;

    return entry.text;
  } catch {
    return null;
  }
}

export async function writeCachedFile(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  text: string,
): Promise<void> {
  // After an extension reload the old page's content script is still alive
  // but its storage handle is dead ("Extension context invalidated") - bail
  // quietly rather than warn on an expected shutdown race. `browser` itself
  // is undefined outside an extension context (e.g. unit tests).
  if (!browser?.runtime?.id) return;

  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const record = (stored[STORAGE_KEY] as Record<string, CachedFile> | undefined) ?? {};
    record[repoFileCacheKey(owner, repo, ref, path)] = {text, ts: Date.now()};
    await browser.storage.local.set({[STORAGE_KEY]: trimRepoFileCache(record)});
  } catch (error) {
    console.warn('[PR Impact]', 'repo-file-cache-write', error);
  }
}
