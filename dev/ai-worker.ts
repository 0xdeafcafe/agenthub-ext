/** Explicit simulation for fast, deterministic UI tests. Never included in the extension. */
import type {WorkerRequest, WorkerResponse} from '../lib/ai/protocol';
import type {ModelId} from '../lib/ai/models';
import {fitContext} from '../lib/ai/search';
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const send = (data: WorkerResponse): void => self.postMessage(data);
const key = (id: ModelId): string => new URL(`/simulated-model/${id}`, location.origin).href;
async function status(id: number): Promise<void> {
  const cache = await caches.open('prix-ai-simulation');
  const installed: ModelId[] = [];
  for (const model of ['qwen', 'gemma'] as const)
    if (await cache.match(key(model))) installed.push(model);
  send({id, type: 'status', installed, simulated: true});
}
self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  void (async () => {
    const message = event.data;
    const {id} = message;
    if (message.type === 'status') await status(id);
    else if (message.type === 'load') {
      for (let i = 0; i <= 4; i++) {
        send({id, type: 'progress', progress: i / 4, text: 'Simulated download'});
        await pause(150);
      }
      await (
        await caches.open('prix-ai-simulation')
      ).put(key(message.model), new Response('simulation'));
      send({id, type: 'ready', model: message.model, loadMs: 750});
      await status(id);
    } else if (message.type === 'remove') {
      await (await caches.open('prix-ai-simulation')).delete(key(message.model));
      send({id, type: 'removed'});
      await status(id);
    } else if (message.type === 'generate') {
      const context = fitContext(message.question, message.sources, (text) =>
        Math.ceil(text.length / 4),
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
        send({id, type: 'token', text: word + ' '});
        await pause(20);
      }
      send({id, type: 'done', elapsedMs: 1000, firstTokenMs: 20, outputTokens: 48});
    } else if (message.type === 'unload') send({id, type: 'unloaded'});
  })().catch((error: unknown) => send({id: event.data.id, type: 'error', message: String(error)}));
};
