/** Explicit simulation for fast, deterministic UI tests. Never included in the extension. */
import type {WorkerRequest, WorkerResponse} from '../lib/ai/protocol';
import type {ModelId} from '../lib/ai/models';
import {fitContext} from '../lib/ai/search';
import {modelLease} from '../lib/ai/lease';
const lease = modelLease();
let stopped = false;
let active: ModelId | null = null;
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const send = (data: WorkerResponse): void => self.postMessage(data);
const key = (id: ModelId): string => new URL(`/simulated-model/${id}`, location.origin).href;
async function status(id: number): Promise<void> {
  const cache = await caches.open('prix-ai-simulation');
  const installed: ModelId[] = [];
  const partial: ModelId[] = [];
  for (const model of ['qwen', 'gemma'] as const)
    if (await cache.match(key(model))) installed.push(model);
    else if (await cache.match(key(model) + '/partial')) partial.push(model);
  send({id, type: 'status', installed, partial, simulated: true});
}
self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  void (async () => {
    const message = event.data;
    const {id} = message;
    if (message.type === 'status') await status(id);
    else if (message.type === 'load') {
      await lease.acquire();
      await (
        await caches.open('prix-ai-simulation')
      ).put(key(message.model) + '/partial', new Response('incomplete'));
      for (let i = 0; i <= 4; i++) {
        send({id, type: 'progress', progress: i / 4, text: 'Simulated download'});
        await pause(150);
      }
      await (
        await caches.open('prix-ai-simulation')
      ).put(key(message.model), new Response('simulation'));
      await (await caches.open('prix-ai-simulation')).delete(key(message.model) + '/partial');
      active = message.model;
      send({id, type: 'ready', model: message.model, loadMs: 750});
      await status(id);
    } else if (message.type === 'remove') {
      await lease.acquire();
      if (active === message.model) active = null;
      await (await caches.open('prix-ai-simulation')).delete(key(message.model));
      await (await caches.open('prix-ai-simulation')).delete(key(message.model) + '/partial');
      send({id, type: 'removed'});
      await status(id);
      if (!active) lease.release();
    } else if (message.type === 'generate') {
      stopped = false;
      const context = fitContext(
        message.question,
        message.sources,
        (text) => Math.ceil(text.length / 4),
        2700,
        message.previousQuestion,
        message.mode,
      );
      send({
        id,
        type: 'context',
        sources: context.sources,
        omitted: context.omitted,
        inputTokens: Math.ceil(context.prompt.length / 4),
      });
      const text = `Development simulation. These excerpts show changes in ${context.sources[0]?.path ?? 'the diff'} [${context.sources[0]?.id ?? 'S1'}]. A real model will use the selected code to answer your question. This preview tests the interface only.`;
      for (const word of text.split(' ')) {
        if (stopped) break;
        send({id, type: 'token', text: word + ' '});
        await pause(20);
      }
      send({id, type: 'done', elapsedMs: 1000, firstTokenMs: 20, outputTokens: 48, stopped});
    } else if (message.type === 'stop') stopped = true;
    else if (message.type === 'unload') {
      active = null;
      lease.release();
      send({id, type: 'unloaded'});
    }
  })().catch((error: unknown) => send({id: event.data.id, type: 'error', message: String(error)}));
};
