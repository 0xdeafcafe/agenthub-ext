import {browser} from 'wxt/browser';
import type {ImpactMap} from './impact-report';
import type {CategoryCount} from './impact-bar';

/**
 * Per-PR aggregate cache. On a virtualised PR the bar otherwise starts at 0
 * and grows as files mount; this lets a revisit (or soft-nav away and back)
 * open on the last-known full picture.
 *
 * Entries are keyed owner/repo#number and carry the PR head SHA when we can
 * find one: same SHA (or no SHA either side) means the cache is usable, a
 * different SHA means the PR moved on and the cache is ignored. Display is
 * seeded from the cache and hands over to live counts once they cover at
 * least as many files - the two are never summed.
 */

export interface PrCacheEntry {
  sha: string | null;
  counts: Record<string, CategoryCount>;
  impactMap: ImpactMap | null;
  ts: number;
}

const STORAGE_KEY = 'prix:prCounts';
const MAX_ENTRIES = 25;

export function prCacheKey(owner: string, repo: string, prNumber: string): string {
  return `${owner}/${repo}#${prNumber}`;
}

/** Fresh unless both sides know a SHA and they differ. */
export function isCacheFresh(entry: Pick<PrCacheEntry, 'sha'>, pageSha: string | null): boolean {
  return pageSha === null || entry.sha === null || entry.sha === pageSha;
}

function totalFiles(counts: Record<string, CategoryCount>): number {
  return Object.values(counts).reduce((sum, count) => sum + count.files, 0);
}

/**
 * What the bar should show: the cached picture until live counting has
 * mounted at least as many files, live from then on. Never a mixture.
 */
export function displayCounts(
  cached: Record<string, CategoryCount> | null,
  live: Record<string, CategoryCount>,
): Record<string, CategoryCount> {
  if (!cached) {
    return live;
  }

  const liveTotal = totalFiles(live);
  return liveTotal >= totalFiles(cached) && liveTotal > 0 ? live : cached;
}

/** LRU trim: keep the newest `max` entries by timestamp. Pure. */
export function trimCache(record: Record<string, PrCacheEntry>, max = MAX_ENTRIES): Record<string, PrCacheEntry> {
  const keys = Object.keys(record);
  if (keys.length <= max) {
    return record;
  }

  const byAge = keys.sort((a, b) => (record[b].ts ?? 0) - (record[a].ts ?? 0));
  return Object.fromEntries(byAge.slice(0, max).map(key => [key, record[key]]));
}

/**
 * The PR head SHA from the page, best effort. GitHub embeds it in JSON
 * script payloads under a few spellings; null when none turn up (the caller
 * then treats any cached entry as usable).
 */
export function extractHeadSha(doc: Document): string | null {
  for (const script of doc.querySelectorAll('script[type="application/json"]')) {
    const text = script.textContent ?? '';
    const match = /"(?:headSha|head_sha|headRefOid|headRef\.oid)":\s*"([0-9a-f]{7,40})"/.exec(text);
    if (match) {
      return match[1];
    }
  }

  return null;
}

export async function readPrCounts(key: string): Promise<PrCacheEntry | null> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const record = (stored[STORAGE_KEY] as Record<string, PrCacheEntry> | undefined) ?? {};
    return record[key] ?? null;
  } catch {
    return null;
  }
}

export async function writePrCounts(key: string, entry: PrCacheEntry): Promise<void> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const record = (stored[STORAGE_KEY] as Record<string, PrCacheEntry> | undefined) ?? {};
    record[key] = entry;
    await browser.storage.local.set({[STORAGE_KEY]: trimCache(record)});
  } catch (error) {
    console.error('[PR Impact]', 'pr-counts-write', error);
  }
}
