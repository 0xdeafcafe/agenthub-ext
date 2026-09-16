import {browser} from 'wxt/browser';
import {diffPathForPage, parseDiff, type DiffInventory} from './diff';

export type InventoryResult = {inventory: DiffInventory | null; reason?: string};
const MAX_DIFF_BYTES = 20 * 1024 * 1024;

export async function readDiffResponse(response: Response): Promise<DiffInventory> {
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
    return parseDiff(parts.join(''));
  } finally {
    reader.releaseLock();
  }
}

export async function fetchInventory(url: URL, signal: AbortSignal): Promise<InventoryResult> {
  const path = diffPathForPage(url);
  if (!path) return {inventory: null, reason: 'Counts cover files loaded in this comparison'};
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
