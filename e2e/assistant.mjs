import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {startPreview} from '../dev/server.mjs';
import {browserPath} from './browser.mjs';
const preview = await startPreview({port: 0, watch: false});
const browser = await chromium.launch({executablePath: browserPath(), headless: true});
const page = await browser.newPage({viewport: {width: 1440, height: 1050}});
const errors = [];
const external = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
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
  assert.match(await ai.locator('#models-summary').textContent(), /simulation/);
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
  // The simulated worker stores no weights, even on a CI runner with little free disk.
  await ai.locator('body').evaluate(() => {
    navigator.storage.estimate = async () => ({quota: 1024, usage: 0});
  });
  await ai.locator('#models summary').click();
  await ai.locator('#install-both').click();
  await ai.locator('#load-progress:not([hidden])').waitFor();
  await shot('download-dark');
  await ai.locator('#active-model').filter({hasText: 'Gemma'}).waitFor();
  await ai.locator('#question').fill('What changed in next?');
  await ai.locator('#send').click();
  await ai.locator('.compare').waitFor();
  assert.match(await ai.locator('.answer').textContent(), /Development simulation/);
  assert.match(await ai.locator('.sources summary').first().textContent(), /Sources used/);
  await shot('answer-dark');
  await ai.locator('.compare').click();
  await ai.locator('.compare').nth(1).waitFor();
  assert.match(await ai.locator('.message-header strong').nth(1).textContent(), /Qwen/);
  await ai.locator('#send').evaluate((button) => {
    button.click();
    document.getElementById('stop').click();
  });
  assert.match(await ai.locator('#task-status').textContent(), /Stopped/);
  assert.equal(await ai.locator('#active-model').textContent(), 'No model loaded');
  await ai.locator('#close').click();
  await page.locator('#prix-ai-panel iframe').waitFor({state: 'detached'});
  await page.locator('#prix-ai-launch').click();
  await ai.locator('#coverage').filter({hasText: '8 files'}).waitFor();
  await ai.locator('#models summary').click();
  await ai.getByRole('button', {name: 'Remove Qwen3.5 2B', exact: true}).waitFor();
  await shot('installed-dark');
  await ai.getByRole('button', {name: 'Remove Qwen3.5 2B', exact: true}).click();
  await ai
    .getByRole('button', {name: 'Install or use Qwen3.5 2B'})
    .filter({hasText: 'Install'})
    .waitFor();
  await ai.getByRole('button', {name: 'Install or use Qwen3.5 2B'}).click();
  await ai.locator('#cancel-load').click();
  assert.match(await ai.locator('#task-status').textContent(), /cancelled/);
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
    'PASS assistant: local search, citations, two installs, comparison, stop, cache, remove, cancel, navigation, themes, mobile, no external requests (simulation)',
  );
} finally {
  await browser.close();
  await preview.close();
}
