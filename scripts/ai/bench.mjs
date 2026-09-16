/** Opt-in real inference. Downloads ~3.1 GB; never run by regular tests or CI. */
import {chromium} from 'playwright-core';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startPreview} from '../../dev/server.mjs';
import {browserPath} from '../../e2e/browser.mjs';
import {prepareAiAssets} from './assets.mjs';
import {cases} from './cases.mjs';
const args = process.argv.slice(2);
const production = args.includes('--extension');
const offline = args.includes('--offline');
const models = args.filter((arg) => !arg.startsWith('--'));
if (!models.length) models.push('qwen', 'gemma');
if (
  models.some((model) => !['qwen', 'gemma'].includes(model)) ||
  args.some((arg) => arg.startsWith('--') && !['--extension', '--offline'].includes(arg))
)
  throw new Error('Usage: bench.mjs [--extension] [--offline] [qwen] [gemma]');
if (!production) await prepareAiAssets();
const preview = production ? null : await startPreview({port: 4174, watch: false, realAi: true});
const output = resolve('.output/ai-benchmark');
await mkdir(output, {recursive: true});
const extension = resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  resolve(production ? '.output/ai-extension-profile' : '.output/ai-browser-profile'),
  {
    executablePath: browserPath({extension: production}),
    headless: !production,
    args: [
      '--enable-unsafe-webgpu',
      ...(production
        ? [
            '--headless=new',
            `--disable-extensions-except=${extension}`,
            `--load-extension=${extension}`,
          ]
        : []),
    ],
  },
);
const page = context.pages()[0] ?? (await context.newPage());
page.on('pageerror', (error) => console.error('PAGE', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.error('BROWSER', message.text().slice(0, 1000));
});
page.on('requestfailed', (request) =>
  console.error('NETWORK', request.url().slice(0, 180), request.failure()),
);
const progress = new Map();
await page.exposeFunction('report', (message) => {
  if (message.type === 'token') return;
  if (message.type === 'progress') {
    const step = Math.floor(message.progress * 20);
    if (progress.get(message.model) === step) return;
    progress.set(message.model, step);
  }
  console.log(JSON.stringify(message));
});
try {
  let permissions = null;
  if (production) {
    const background = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const origin = new URL(background.url()).host;
    await page.goto(`chrome-extension://${origin}/assistant.html`);
    permissions = await background.evaluate(() => globalThis.chrome.permissions.getAll());
  } else await page.goto(preview.url, {waitUntil: 'domcontentloaded'});
  if (offline) await context.setOffline(true);
  const results = [];
  for (const model of models) {
    const result = await page.evaluate(
      async ({model, cases}) => {
        const worker = new Worker('/ai-worker.js', {type: 'module'});
        let id = 0;
        const request = (data, until) =>
          new Promise((resolve, reject) => {
            const current = ++id;
            let text = '';
            const events = [];
            const timeout = setTimeout(
              () => reject(new Error('Model operation timed out')),
              data.type === 'load' ? 1200000 : 120000,
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
          const answers = [];
          for (const scenario of cases) {
            const answer = await request(
              {
                type: 'generate',
                question: scenario.question,
                sources: scenario.sources,
                previousQuestion: '',
              },
              'done',
            );
            const supplied = new Set(scenario.sources.map((source) => source.id));
            const citations = [
              ...answer.text.matchAll(
                /\[(S\d+)(?:[,:]\s*(?:[LR]\d+(?:[-–][LR]?\d+)?|old|new))?\]/g,
              ),
            ].map((match) => match[1]);
            const invalid = citations.filter((id) => !supplied.has(id));
            if (!answer.text.trim() || invalid.length)
              throw new Error(`Empty answer or invented citations for ${scenario.name}`);
            answers.push({...scenario, ...answer, citations: [...new Set(citations)]});
          }
          return {model, load, answers};
        } catch (error) {
          return {model, error: String(error)};
        } finally {
          worker.terminate();
        }
      },
      {model, cases},
    );
    results.push(result);
    const report = {
      date: new Date().toISOString(),
      browser: context.browser()?.version(),
      runtime: production ? 'extension' : 'preview',
      offline,
      permissions,
      result,
    };
    await writeFile(
      resolve(output, `${report.runtime}-${model}${offline ? '-offline' : ''}.json`),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          model,
          error: result.error,
          answers: result.answers?.map(({name, text}) => ({name, text})),
        },
        null,
        2,
      ),
    );
  }
  if (results.some((result) => result.error)) process.exitCode = 1;
} finally {
  await context.close();
  await preview?.close();
}
