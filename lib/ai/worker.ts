import type {MLCEngine, AppConfig} from '@mlc-ai/web-llm';
import type {Engine, Conversation} from '@litert-lm/core';
import type {Tokenizer} from '@mlc-ai/web-tokenizers';
import {modelById, modelUrl, type ModelId} from './models';
import {cachedTokenizer, gemmaFile, gemmaInstalled, removeGemma, removeTokenizer} from './storage';
import {loadPackagedLiteRt} from './litert';
import {fitContext} from './search';
import type {WorkerRequest, WorkerResponse} from './protocol';

let qwen: MLCEngine | null = null;
let gemma: Engine | null = null;
let conversation: Conversation | null = null;
let tokenizer: Tokenizer | null = null;
let active: ModelId | null = null;
let busy = false;
let stopped = false;
const send = (message: WorkerResponse): void => self.postMessage(message);
const assets = new URL('../../ai/', self.location.href);
// Worker chunks live under assets/ in production, and at /ai-worker.js in preview.
assets.pathname = '/ai/';
const qwenConfig = async (): Promise<AppConfig> => {
  const {prebuiltAppConfig} = await import('@mlc-ai/web-llm');
  const record = prebuiltAppConfig.model_list.find(
    (model) => model.model_id === modelById('qwen').runtimeId,
  )!;
  return {
    model_list: [
      {...record, model: modelUrl('qwen'), model_lib: new URL('qwen-2b.wasm', assets).href},
    ],
    cacheBackend: 'cache',
  };
};
async function unload(): Promise<void> {
  if (conversation) {
    await conversation.delete();
    conversation = null;
  }
  if (qwen) {
    await qwen.unload();
    qwen = null;
  }
  if (gemma) {
    await gemma.delete();
    gemma = null;
  }
  tokenizer?.dispose();
  tokenizer = null;
  active = null;
}
async function status(id: number): Promise<void> {
  const {hasModelInCache} = await import('@mlc-ai/web-llm');
  const installed: ModelId[] = [];
  if (await hasModelInCache(modelById('qwen').runtimeId, await qwenConfig()).catch(() => false))
    installed.push('qwen');
  if (await gemmaInstalled()) installed.push('gemma');
  send({id, type: 'status', installed});
}
async function handle(message: WorkerRequest): Promise<void> {
  const {id} = message;
  if (message.type === 'stop') {
    stopped = true;
    await qwen?.interruptGenerate();
    conversation?.cancel();
    return;
  }
  if (message.type === 'status') {
    await status(id);
    return;
  }
  if (busy) throw new Error('Wait for the current operation or stop it first.');
  busy = true;
  try {
    if (message.type === 'load') {
      const start = performance.now();
      await unload();
      const adapter = await (
        navigator as Navigator & {gpu?: {requestAdapter(): Promise<{features: Set<string>} | null>}}
      ).gpu?.requestAdapter();
      if (!adapter)
        throw new Error(
          'WebGPU is unavailable. Search still works; enable browser graphics acceleration to use a model.',
        );
      if (!adapter.features.has('shader-f16'))
        throw new Error('This GPU does not support the selected model. Search is still available.');
      const progress = (progress: number, text: string): void =>
        send({id, type: 'progress', progress, text});
      progress(0, `Loading ${modelById(message.model).name}…`);
      if (message.model === 'qwen') {
        const {CreateMLCEngine} = await import('@mlc-ai/web-llm');
        qwen = await CreateMLCEngine(
          modelById('qwen').runtimeId,
          {
            appConfig: await qwenConfig(),
            initProgressCallback: (report) => progress(report.progress, report.text),
          },
          {context_window_size: 4096, temperature: 0.2},
        );
      } else {
        const {Engine} = await import('@litert-lm/core');
        const file = await gemmaFile(progress);
        progress(1, 'Loading Gemma into GPU memory…');
        await loadPackagedLiteRt(new URL('litert/', assets));
        gemma = await Engine.create({
          model: file,
          mainExecutorSettings: {maxNumTokens: 4096},
          benchmarkEnabled: true,
        });
      }
      const {Tokenizer} = (await import(
        /* @vite-ignore */ new URL('tokenizers.js', assets).href
      )) as typeof import('@mlc-ai/web-tokenizers');
      tokenizer = await Tokenizer.fromJSON(await cachedTokenizer(message.model));
      active = message.model;
      await status(id);
      send({id, type: 'ready', model: active, loadMs: performance.now() - start});
    } else if (message.type === 'remove') {
      if (active === message.model) await unload();
      if (message.model === 'qwen') {
        const {deleteModelAllInfoInCache} = await import('@mlc-ai/web-llm');
        await deleteModelAllInfoInCache(modelById('qwen').runtimeId, await qwenConfig());
      } else await removeGemma();
      await removeTokenizer(message.model);
      await status(id);
      send({id, type: 'removed'});
    } else if (message.type === 'unload') {
      await unload();
      send({id, type: 'unloaded'});
    } else if (message.type === 'generate') {
      if (!active || !tokenizer) throw new Error('Load a model first.');
      stopped = false;
      const count = (text: string): number => tokenizer!.encode(text).length;
      const context = fitContext(
        message.question,
        message.sources,
        count,
        2700,
        message.previousQuestion,
      );
      if (!context.sources.length)
        throw new Error(
          'No relevant excerpts fit. Search for a specific behavior or choose a smaller scope.',
        );
      send({
        id,
        type: 'context',
        sources: context.sources,
        omitted: context.omitted,
        inputTokens: count(context.prompt),
      });
      const start = performance.now();
      let firstTokenMs = 0;
      let output = '';
      const token = (text: string): void => {
        if (!text || stopped) return;
        if (!firstTokenMs) firstTokenMs = performance.now() - start;
        output += text;
        send({id, type: 'token', text});
      };
      if (qwen) {
        await qwen.resetChat();
        const stream = await qwen.chat.completions.create({
          messages: [{role: 'user', content: context.prompt}],
          stream: true,
          max_tokens: 700,
          temperature: 0.2,
          extra_body: {enable_thinking: false},
        });
        for await (const chunk of stream) {
          if (stopped) break;
          token(chunk.choices[0]?.delta.content ?? '');
        }
      } else if (gemma) {
        conversation = await gemma.createConversation({
          preface: {extra_context: {enable_thinking: false}},
          sessionConfig: {maxOutputTokens: 700},
        });
        for await (const chunk of conversation.sendMessageStreaming(context.prompt)) {
          if (stopped) break;
          if (typeof chunk.content === 'string') token(chunk.content);
          else
            for (const content of chunk.content ?? [])
              if (content.type === 'text') token(content.text);
        }
        await conversation.delete();
        conversation = null;
      }
      send({
        id,
        type: 'done',
        elapsedMs: performance.now() - start,
        firstTokenMs,
        outputTokens: count(output),
      });
    }
  } finally {
    busy = false;
  }
}
self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  void handle(event.data).catch((error: unknown) => {
    send({
      id: event.data.id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
};
