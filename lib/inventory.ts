import {browser} from 'wxt/browser';
import {diffPathForPage, parseDiff, type DiffInventory} from './diff';
import {
  inventoryCacheKey,
  readCachedInventory,
  writeCachedInventory,
  type DiffRevision,
} from './inventory-cache';

export type InventoryResult = {inventory: DiffInventory | null; reason?: string; cached?: boolean};
const MAX_DIFF_BYTES = 20 * 1024 * 1024;

export async function readDiffResponse(response: Response): Promise<DiffInventory> {
  return parseDiff(await readDiffText(response));
}

export async function readDiffText(response: Response): Promise<string> {
  if (!response.ok || !response.body) throw new Error('GitHub could not supply the full diff');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_DIFF_BYTES) {
        await reader.cancel();
        throw new Error('Diff exceeds the 20 MB limit');
      }
      parts.push(decoder.decode(value, {stream: true}));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally {
    reader.releaseLock();
  }
}

/**
 * The full-diff inventory, from the per-revision cache when this exact diff
 * was counted before; otherwise downloaded, parsed and cached.
 */
export async function fetchInventory(
  url: URL,
  signal: AbortSignal,
  revision: DiffRevision = {head: null, base: null},
): Promise<InventoryResult> {
  const path = diffPathForPage(url);
  if (!path) return {inventory: null, reason: 'Counts cover files loaded in this comparison'};
  const key = inventoryCacheKey(path, revision);
  const cached = key ? await readCachedInventory(key) : null;
  if (cached) return {inventory: cached, cached: true};
  const result = await downloadInventory(path, signal);
  if (key && result.inventory?.complete) void writeCachedInventory(key, result.inventory);
  return result;
}

async function downloadInventory(path: string, signal: AbortSignal): Promise<InventoryResult> {
  try {
    // Same-origin works for private diffs; public diffs may redirect to GitHub's
    // patch host. The extension worker handles that CORS boundary when needed.
    const inventory = await readDiffResponse(
      await fetch(path, {
        credentials: 'include',
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
      }),
    );
    if (inventory.complete) return {inventory};
  } catch {
    if (signal.aborted) return {inventory: null};
  }
  try {
    const result = (await browser.runtime.sendMessage({
      type: 'prix:inventory',
      path,
    })) as InventoryResult;
    if (!signal.aborted && result?.inventory?.complete) return result;
  } catch {
    /* Local preview or unavailable worker: retain the mounted files. */
  }
  return {inventory: null, reason: 'Full diff unavailable · counts cover loaded files'};
}
