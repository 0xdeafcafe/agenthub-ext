/** Opt-in real inference. Downloads ~3.1 GB; never run by regular tests or CI. */
import {chromium} from 'playwright-core';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startPreview} from '../../dev/server.mjs';
import {browserPath} from '../../e2e/browser.mjs';
import {prepareAiAssets} from './assets.mjs';
await prepareAiAssets();
const preview = await startPreview({port: 4174, watch: false, realAi: true});
const output = resolve('.output/ai-benchmark');
await mkdir(output, {recursive: true});
const context = await chromium.launchPersistentContext(resolve('.output/ai-browser-profile'), {
  executablePath: browserPath(),
  headless: true,
  args: ['--enable-unsafe-webgpu'],
});
const page = context.pages()[0] ?? (await context.newPage());
page.on('pageerror', (error) => console.error('PAGE', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.error('BROWSER', message.text().slice(0, 1000));
});
page.on('requestfailed', (request) =>
  console.error('NETWORK', request.url().slice(0, 180), request.failure()),
);
await page.exposeFunction('report', (message) => {
  if (message.type !== 'token') console.log(JSON.stringify(message));
});
await page.goto(preview.url, {waitUntil: 'domcontentloaded'});
try {
  const results = await page.evaluate(
    async (models) => {
      const results = [];
      const source = {
        id: 'S1',
        path: 'src/session.ts',
        category: 'code',
        oldStart: 1,
        oldEnd: 4,
        newStart: 1,
        newEnd: 4,
        added: 1,
        removed: 1,
        text: ' R1 export function validateSession(session, now) {\n-L2   if (session.expiresAt <= now) return null;\n+R2   if (session.expiresAt < now) return null;\n R3   return session.user;\n R4 }\n',
      };
      for (const model of models) {
        const worker = new Worker('/ai-worker.js', {type: 'module'});
        let id = 0;
        const request = (data, until) =>
          new Promise((resolve, reject) => {
            const current = ++id;
            let text = '';
            const events = [];
            const timeout = setTimeout(
              () => reject(new Error('Model operation timed out')),
              1200000,
            );
            worker.onerror = (event) => {
              clearTimeout(timeout);
              reject(new Error(event.message));
            };
            worker.onmessage = (event) => {
              const message = event.data;
              if (message.id !== current) return;
              void window.report({...message, model});
              events.push(message);
              if (message.type === 'token') text += message.text;
              if (message.type === 'error') {
                clearTimeout(timeout);
                reject(new Error(message.message));
              } else if (message.type === until) {
                clearTimeout(timeout);
                resolve({text, events});
              }
            };
            worker.postMessage({id: current, ...data});
          });
        try {
          const load = await request({type: 'load', model}, 'ready');
          const answer = await request(
            {
              type: 'generate',
              question:
                'What exact behavior changed at the expiry boundary? Cite the relevant source and suggest a focused test.',
              sources: [source],
              previousQuestion: '',
            },
            'done',
          );
          results.push({model, load, answer});
        } catch (error) {
          results.push({model, error: String(error)});
        } finally {
          worker.terminate();
        }
      }
      return results;
    },
    process.argv.slice(2).length ? process.argv.slice(2) : ['qwen', 'gemma'],
  );
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      {date: new Date().toISOString(), browser: context.browser()?.version(), results},
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      results.map(({model, error, answer}) => ({model, error, answer: answer?.text})),
      null,
      2,
    ),
  );
  if (results.some((result) => result.error)) process.exitCode = 1;
} finally {
  await context.close();
  await preview.close();
}
