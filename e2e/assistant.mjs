import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {startPreview} from '../dev/server.mjs';
import {browserPath} from './browser.mjs';
const preview = await startPreview({port: 0, watch: false});
const browser = await chromium.launch({executablePath: browserPath(), headless: true});
const context = await browser.newContext({viewport: {width: 1440, height: 1050}});
const page = await context.newPage();
const errors = [];
const external = [];
page.on('pageerror', (error) => errors.push(error.message));
page.context().on('request', (request) => {
  if (!request.url().startsWith(preview.url)) external.push(request.url());
});
const shot = async (name) =>
  page.locator('#prix-ai-panel').screenshot({path: `e2e/screenshots/local/assistant-${name}.png`});
try {
  await mkdir('e2e/screenshots/local', {recursive: true});
  await page.goto(preview.url + '/acme/review-kit/pull/42/changes?theme=dark');
  await page
    .locator('#prix-ai-launch')
    .screenshot({path: 'e2e/screenshots/local/assistant-launcher-dark.png'});
  await page.evaluate(() => {
    const policy = document.createElement('meta');
    policy.name = 'referrer';
    policy.content = 'no-referrer';
    document.head.append(policy);
  });
  await page.locator('#prix-ai-launch').click();
  const ai = page.frameLocator('#prix-ai-panel iframe');
  await ai.locator('#coverage').filter({hasText: '8 files'}).waitFor();
  assert.equal(await ai.locator('body').evaluate(() => document.referrer), '');
  // The source index and worker status arrive independently.
  await ai.locator('#models-summary').filter({hasText: 'simulation'}).waitFor();
  await ai.locator('body').evaluate(() => {
    window.modelRequests = [];
    // oxlint-disable-next-line typescript/unbound-method -- Invoked with the original Worker receiver below.
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message.type === 'generate') window.modelRequests.push(structuredClone(message));
      return post.call(this, message, ...rest);
    };
  });
  assert.equal(await ai.locator('#model-cards button').filter({hasText: 'Install'}).count(), 2);
  await shot('welcome-dark');
  await ai.locator('#question').fill('next');
  await ai.locator('#search').click();
  await ai.locator('.sources[open] .source').first().waitFor();
  assert.equal(await ai.locator('.answer').count(), 0);
  await shot('search-dark');
  const firstSource = ai.locator('.source button').first();
  await firstSource.click();
  await page.waitForFunction(() => location.hash.startsWith('#diff-'));
  await ai.locator('#clear').click();
  await ai.locator('#question').fill('What changed in next?');
  await ai.locator('#send').click();
  await ai.locator('#task-status').filter({hasText: 'Your question will run'}).waitFor();
  await ai.locator('#question').fill('What changed in next, and why?');
  // The simulated worker stores no weights, even on a CI runner with little free disk.
  await ai.locator('body').evaluate(() => {
    navigator.storage.estimate = async () => ({quota: 1024, usage: 0});
  });
  await ai.locator('#install-both').click();
  await ai.locator('#load-progress:not([hidden])').waitFor();
  await shot('download-dark');
  await ai.locator('#active-model').filter({hasText: 'Gemma'}).waitFor();
  await ai.locator('.compare').waitFor();
  assert.match(await ai.locator('.answer').textContent(), /Development simulation/);
  assert.match(await ai.locator('.sources summary').first().textContent(), /Sources used/);
  await shot('answer-dark');
  await page
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write'], {origin: preview.url});
  await ai.getByRole('button', {name: 'Copy answer', exact: true}).click();
  await ai.locator('#task-status').filter({hasText: 'copied'}).waitFor();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /What changed in next, and why\?[\s\S]*\[S\d+\]/,
  );
  await ai.locator('.answer .citation').first().click();
  await ai.locator('.retry').click();
  await ai.locator('.compare').nth(1).waitFor();
  await ai.locator('.compare').first().click();
  await ai.locator('.compare').nth(2).waitFor();
  assert.match(await ai.locator('.message-header strong').nth(2).textContent(), /Qwen/);
  const requests = await ai.locator('body').evaluate(() =>
    window.modelRequests.map(({question, sources, previousQuestion, mode}) => ({
      question,
      ids: sources.map(({id}) => id),
      previousQuestion,
      mode,
    })),
  );
  assert.equal(requests[0].question, 'What changed in next, and why?');
  // First request contains all candidates; retry and compare use its fitted source set.
  assert.deepEqual(requests[1], requests[2]);
  assert.equal(requests[2].previousQuestion, requests[0].previousQuestion);
  await ai.locator('#send').evaluate((button) => {
    button.click();
    document.getElementById('stop').click();
  });
  await ai.locator('#task-status').filter({hasText: 'Stopped.'}).waitFor();
  assert.match(await ai.locator('#active-model').textContent(), /Qwen/);
  const count = await ai.locator('.message').count();

  // Separate PR tabs share the same download cache and model lease.
  const second = await page.context().newPage();
  await second.goto(preview.url + '/acme/review-kit/pull/42/changes?theme=dark&second-tab=1');
  await second.locator('#prix-ai-launch').click();
  const other = second.frameLocator('#prix-ai-panel iframe');
  await other.locator('#models-summary').filter({hasText: 'simulation'}).waitFor();
  await other.locator('#models summary').click();
  await other.getByRole('button', {name: 'Install or use Gemma 4 E2B'}).click();
  await other.locator('#model-message').filter({hasText: 'Another PR tab'}).waitFor();
  await other.locator('#question').fill('next');
  await other.locator('#search').click();
  await other.locator('.sources .source').first().waitFor();
  await ai.locator('#close').click();
  await page.locator('#prix-ai-panel').waitFor({state: 'hidden'});
  await other.getByRole('button', {name: 'Install or use Gemma 4 E2B'}).click();
  await other.locator('#active-model').filter({hasText: 'Gemma'}).waitFor();
  await second.close();
  await page.locator('#prix-ai-launch').click();
  await ai.locator('#coverage').filter({hasText: '8 files'}).waitFor();
  assert.equal(await ai.locator('.message').count(), count);
  assert.equal(await ai.locator('#active-model').textContent(), 'No model loaded');
  await ai.locator('#models summary').click();
  await ai.getByRole('button', {name: 'Remove Qwen3.5 2B', exact: true}).waitFor();
  await shot('installed-dark');
  await ai.getByRole('button', {name: 'Remove Qwen3.5 2B', exact: true}).click();
  await ai
    .getByRole('button', {name: 'Install or use Qwen3.5 2B'})
    .filter({hasText: 'Install'})
    .waitFor();
  await ai.getByRole('button', {name: 'Install or use Qwen3.5 2B'}).click();
  await ai.locator('#load-message').filter({hasText: 'Simulated download'}).waitFor();
  await ai.locator('#cancel-load').click();
  assert.match(await ai.locator('#task-status').textContent(), /cancelled/);
  await ai
    .getByRole('button', {name: 'Install or use Qwen3.5 2B'})
    .filter({hasText: 'Retry'})
    .waitFor();
  await ai.getByRole('button', {name: 'Remove Qwen3.5 2B', exact: true}).click();
  await ai
    .getByRole('button', {name: 'Install or use Qwen3.5 2B'})
    .filter({hasText: 'Install'})
    .waitFor();
  await ai.locator('#close').click();
  await page.goto(preview.url + '/acme/review-kit/pull/42/changes?theme=light');
  await page.locator('#prix-ai-launch').click();
  await ai.locator('#coverage').filter({hasText: '8 files'}).waitFor();
  await shot('welcome-light');
  await page.setViewportSize({width: 390, height: 844});
  await shot('mobile-light');
  assert.equal(await ai.locator('body').evaluate((body) => body.scrollWidth <= innerWidth), true);
  await ai.locator('#close').click();
  await page.goto(preview.url + '/acme/review-kit/pull/42');
  assert.equal(await page.locator('#prix-ai-launch').count(), 0);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(
    'PASS assistant: queued questions, search, citations, copy/retry/compare, stop without reload, retained conversation, two installs, partial removal, multi-tab exclusion, navigation, themes, mobile, no external requests (simulation)',
  );
} finally {
  await browser.close();
  await preview.close();
}
