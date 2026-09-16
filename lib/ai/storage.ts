import {modelById, modelUrl, tokenizerUrl, type ModelId} from './models';
const CACHE = 'prix-ai-tokenizers-v1';
const GEMMA_BYTES = 2_008_432_640;
const GEMMA_FILE = 'prix-gemma-4-e2b-b3ca0d2f.litertlm';
const QWEN_CACHES = ['webllm/model', 'webllm/config', 'webllm/wasm'];
export async function tokenizerInstalled(model: ModelId): Promise<boolean> {
  return Boolean(await (await caches.open(CACHE)).match(tokenizerUrl(model)));
}
export async function qwenMetadataInstalled(): Promise<boolean> {
  return Boolean(
    (await (await caches.open('webllm/config')).match(modelUrl('qwen') + 'mlc-chat-config.json')) &&
    (await (await caches.open('webllm/model')).match(modelUrl('qwen') + 'tokenizer.json')),
  );
}

/** Includes interrupted downloads, so they can be retried or removed offline. */
export async function modelHasData(model: ModelId): Promise<boolean> {
  if (await tokenizerInstalled(model)) return true;
  if (model === 'gemma') {
    try {
      await (await navigator.storage.getDirectory()).getFileHandle(GEMMA_FILE);
      return true;
    } catch {
      return false;
    }
  }
  for (const name of QWEN_CACHES) {
    const keys = await (await caches.open(name)).keys();
    if (keys.some((key) => key.url.startsWith(modelUrl(model)))) return true;
  }
  return false;
}

/** WebLLM's removal helper fetches its shard manifest when absent. Never fetch on removal. */
export async function removeQwen(wasmUrl: string): Promise<void> {
  for (const name of QWEN_CACHES) {
    const cache = await caches.open(name);
    for (const key of await cache.keys())
      if (key.url.startsWith(modelUrl('qwen')) || key.url === wasmUrl) await cache.delete(key);
  }
}
export async function cachedTokenizer(model: ModelId): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE);
  const url = tokenizerUrl(model);
  const cached = await cache.match(url);
  if (cached) return cached.arrayBuffer();
  const response = await fetch(url, {credentials: 'omit'});
  if (!response.ok) throw new Error(`Tokenizer download failed (${response.status}).`);
  await cache.put(url, response.clone());
  return response.arrayBuffer();
}
export async function removeTokenizer(model: ModelId): Promise<void> {
  await (await caches.open(CACHE)).delete(tokenizerUrl(model));
}
export async function gemmaInstalled(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(GEMMA_FILE)).getFile();
    return file.size === GEMMA_BYTES;
  } catch {
    return false;
  }
}
export async function gemmaFile(progress: (fraction: number, text: string) => void): Promise<File> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(GEMMA_FILE, {create: true});
  const cached = await handle.getFile();
  if (cached.size === GEMMA_BYTES) return cached;
  const response = await fetch(modelUrl('gemma') + modelById('gemma').runtimeId, {
    credentials: 'omit',
  });
  if (!response.ok || !response.body)
    throw new Error(`Gemma download failed (${response.status}).`);
  const writer = await handle.createWritable();
  const reader = response.body.getReader();
  let bytes = 0;
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let reported = 0;
  const flush = async (): Promise<void> => {
    if (!pendingBytes) return;
    const block = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const part of pending) {
      block.set(part, offset);
      offset += part.byteLength;
    }
    await writer.write(block);
    pending = [];
    pendingBytes = 0;
  };
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > GEMMA_BYTES) throw new Error('Unexpected model download size.');
      pending.push(value);
      pendingBytes += value.byteLength;
      if (pendingBytes >= 4 * 1024 * 1024) await flush();
      if (performance.now() - reported > 250 || bytes === GEMMA_BYTES) {
        reported = performance.now();
        progress(bytes / GEMMA_BYTES, `Downloading Gemma · ${Math.round(bytes / 1e6)} / 2008 MB`);
      }
    }
    await flush();
    if (bytes !== GEMMA_BYTES) throw new Error('Model download was interrupted. Try again.');
    await writer.close();
    return handle.getFile();
  } catch (error) {
    await reader.cancel().catch(() => {});
    await writer.abort().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
export async function removeGemma(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(GEMMA_FILE);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
}
