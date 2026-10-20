import {browser} from 'wxt/browser';
import type {DiffFile, DiffInventory} from './diff';

/** A file row stored compactly: path, added, removed, comment-added, comment-removed, binary. */
type StoredFile = [string, number, number, number, number, 0 | 1];
interface StoredInventory {
  files: StoredFile[];
  ts: number;
}

const STORAGE_KEY = 'prix:inventories';
const MAX_ENTRIES = 30;
/** Bump when parseDiff or comment detection changes what a stored count means. */
const FORMAT = 1;

export interface DiffRevision {
  head: string | null;
  base: string | null;
}

/**
 * A diff is fixed by its path plus both revisions, so a complete inventory
 * for that triple never goes stale. Without both SHAs there's no identity.
 */
export function inventoryCacheKey(path: string, revision: DiffRevision): string | null {
  return revision.head && revision.base
    ? `v${FORMAT}:${path}@${revision.base}..${revision.head}`
    : null;
}

export function packInventory(inventory: DiffInventory): StoredFile[] {
  return inventory.files.map((file) => [
    file.path,
    file.added,
    file.removed,
    file.commentAdded,
    file.commentRemoved,
    file.binary ? 1 : 0,
  ]);
}

export function unpackInventory(files: StoredFile[]): DiffInventory {
  return {
    complete: true,
    files: files.map(([path, added, removed, commentAdded, commentRemoved, binary]): DiffFile => ({
      path,
      added,
      removed,
      commentAdded,
      commentRemoved,
      binary: binary === 1,
    })),
  };
}

/** LRU trim: keep the newest `max` entries by timestamp. Pure. */
export function trimInventories(
  record: Record<string, StoredInventory>,
  max = MAX_ENTRIES,
): Record<string, StoredInventory> {
  const keys = Object.keys(record);
  if (keys.length <= max) return record;
  const byAge = keys.sort((a, b) => record[b].ts - record[a].ts);
  return Object.fromEntries(byAge.slice(0, max).map((key) => [key, record[key]]));
}

export async function readCachedInventory(key: string): Promise<DiffInventory | null> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const entry = (stored[STORAGE_KEY] as Record<string, StoredInventory> | undefined)?.[key];
    return entry ? unpackInventory(entry.files) : null;
  } catch {
    return null;
  }
}

export async function writeCachedInventory(key: string, inventory: DiffInventory): Promise<void> {
  // A reloaded extension leaves the old content script with a dead storage handle.
  if (!browser?.runtime?.id || !inventory.complete) return;
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const record = (stored[STORAGE_KEY] as Record<string, StoredInventory> | undefined) ?? {};
    record[key] = {files: packInventory(inventory), ts: Date.now()};
    await browser.storage.local.set({[STORAGE_KEY]: trimInventories(record)});
  } catch (error) {
    console.warn('[PR Impact]', 'inventory-cache-write', error);
  }
}
