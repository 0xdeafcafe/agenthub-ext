import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  gemmaFile,
  modelHasData,
  removeGemma,
  removeQwen,
  removeTokenizer,
  tokenizerInstalled,
  qwenMetadataInstalled,
} from './storage';
import {modelUrl, tokenizerUrl} from './models';

class MemoryCache {
  data = new Map<string, Response>();
  async keys(): Promise<Request[]> {
    return [...this.data.keys()].map((url) => new Request(url));
  }
  async match(key: string | Request): Promise<Response | undefined> {
    return this.data.get(typeof key === 'string' ? key : key.url)?.clone();
  }
  async delete(key: string | Request): Promise<boolean> {
    return this.data.delete(typeof key === 'string' ? key : key.url);
  }
  async put(key: string, value: Response): Promise<void> {
    this.data.set(key, value);
  }
}
let stores: Map<string, MemoryCache>;
const cache = (name: string): MemoryCache => {
  if (!stores.has(name)) stores.set(name, new MemoryCache());
  return stores.get(name)!;
};
beforeEach(() => {
  stores = new Map();
  vi.stubGlobal('caches', {open: async (name: string) => cache(name)});
});
afterEach(() => vi.unstubAllGlobals());

describe('model download storage', () => {
  it('finds and removes partial Qwen artifacts offline without touching other caches', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetch);
    const prefix = modelUrl('qwen');
    const wasm = 'https://extension.test/ai/qwen-2b.wasm';
    await cache('webllm/model').put(prefix + 'params_shard_0.bin', new Response('partial'));
    await cache('webllm/model').put(prefix + 'tensor-cache.json', new Response('{}'));
    await cache('webllm/model').put('https://another-model.test/data', new Response('keep'));
    await cache('webllm/config').put(prefix + 'mlc-chat-config.json', new Response('{}'));
    expect(await qwenMetadataInstalled()).toBe(false);
    await cache('webllm/model').put(prefix + 'tokenizer.json', new Response('{}'));
    expect(await qwenMetadataInstalled()).toBe(true);
    await cache('webllm/wasm').put(wasm, new Response('runtime'));
    await cache('prix-ai-tokenizers-v1').put(tokenizerUrl('qwen'), new Response('{}'));
    expect(await modelHasData('qwen')).toBe(true);
    expect(await tokenizerInstalled('qwen')).toBe(true);
    await removeQwen(wasm);
    await removeTokenizer('qwen');
    expect(await modelHasData('qwen')).toBe(false);
    expect(await tokenizerInstalled('qwen')).toBe(false);
    expect(await qwenMetadataInstalled()).toBe(false);
    expect((await cache('webllm/model').keys()).map((key) => key.url)).toEqual([
      'https://another-model.test/data',
    ]);
    expect(await cache('webllm/wasm').keys()).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('aborts a truncated Gemma download and leaves its partial entry removable', async () => {
    const abort = vi.fn<() => Promise<void>>(async () => {});
    const writer = {write: async () => {}, close: async () => {}, abort};
    let present = false;
    const root = {
      async getFileHandle(_name: string, options?: {create?: boolean}) {
        if (!present && !options?.create) throw new DOMException('Missing', 'NotFoundError');
        present = true;
        return {getFile: async () => new File([], 'model'), createWritable: async () => writer};
      },
      async removeEntry() {
        present = false;
      },
    };
    vi.stubGlobal('navigator', {storage: {getDirectory: async () => root}});
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () => new Response(new Uint8Array([1, 2, 3]))),
    );
    await expect(gemmaFile(() => {})).rejects.toThrow('interrupted');
    expect(abort).toHaveBeenCalledOnce();
    expect(await modelHasData('gemma')).toBe(true);
    await removeGemma();
    expect(await modelHasData('gemma')).toBe(false);
  });
  it('reports storage removal failures instead of claiming success', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: async () => ({
          removeEntry: async () => {
            throw new DOMException('File in use', 'NoModificationAllowedError');
          },
        }),
      },
    });
    await expect(removeGemma()).rejects.toThrow('File in use');
  });
});
