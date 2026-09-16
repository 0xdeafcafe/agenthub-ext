/** Opt-in: exercise the real Install/Use buttons, downloads, stop and offline reuse. */
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {startPreview} from '../../dev/server.mjs';
import {startGithubFixture} from '../../e2e/github-fixture.mjs';
import {browserPath} from '../../e2e/browser.mjs';

const extension = resolve(process.env.PRIX_EXTENSION_DIR ?? '.output/chrome-mv3');
const profile = resolve('.output/ai-install-profile');
const output = resolve('.output/ai-benchmark');
await mkdir(profile, {recursive: true});
await mkdir(output, {recursive: true});
const preview = await startPreview({port: 0, watch: false});
const fixture = await startGithubFixture(preview.url, profile);
let context;
let progress;
let page;
const results = [];
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: browserPath({extension: true}),
    headless: false,
    args: [
      '--headless=new',
      '--enable-unsafe-webgpu',
      ...fixture.args.map((arg) => arg.replace(', MAP * ~NOTFOUND', '')),
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    viewport: {width: 1440, height: 1080},
  });
  const background = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const manifest = await background.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.deepEqual(manifest.host_permissions, [
    'https://github.com/*',
    'https://patch-diff.githubusercontent.com/*',
  ]);
  page = context.pages()[0];
  page.setDefaultTimeout(120_000);
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('Browser:', message.text().slice(0, 400));
  });
  await page.goto('https://github.com/acme/review-kit/pull/42/changes?extension=1&theme=dark');
  await page.locator('#prix-ai-launch').click();
  const ai = page.frameLocator('#prix-ai-panel iframe');
  await ai.locator('#coverage').filter({hasText: '8 files'}).waitFor();
  await ai.locator('#models-summary').filter({hasText: 'installed'}).waitFor();
  let lastProgress = '';
  progress = setInterval(() => {
    void ai
      .locator('#load-message')
      .textContent({timeout: 1000})
      .then((text) => {
        if (text && text !== lastProgress) console.log((lastProgress = text));
      })
      .catch(() => {});
    void ai
      .locator('#task-status')
      .textContent({timeout: 1000})
      .then((text) => console.log('Status:', text))
      .catch(() => {});
  }, 10000);
  const openModels = async () => {
    if (!(await ai.locator('#models').evaluate((element) => element.open)))
      await ai.locator('#models summary').click();
  };
  const waitReady = async (name) => {
    await ai
      .locator('#active-model')
      .filter({hasText: name})
      .or(ai.locator('#model-message[data-error="true"]'))
      .first()
      .waitFor({timeout: 1200000});
    assert.equal(
      await ai.locator('#active-model').textContent(),
      name,
      await ai.locator('#model-message').textContent(),
    );
  };
  for (const name of ['Qwen3.5 2B', 'Gemma 4 E2B']) {
    await ai
      .locator('#question')
      .fill('In one sentence, what changed in the identifier next? Cite one source.');
    await ai.locator('#send').click();
    await openModels();
    const install = ai.getByRole('button', {name: `Install or use ${name}`, exact: true});
    const action = await install.textContent();
    const start = Date.now();
    await install.click();
    await waitReady(name);
    const loadMs = Date.now() - start;
    await ai.locator('.message').last().locator('.compare').waitFor();
    const answer = await ai.locator('.answer').last().textContent();
    assert.ok(answer.trim());
    assert.ok(!(await ai.locator('#models-summary').textContent()).includes('simulation'));
    await ai.locator('#send').click();
    await ai.locator('.answer').last().filter({hasText: /\S/}).waitFor();
    await ai.locator('#stop').click();
    await ai.locator('#task-status').filter({hasText: 'Stopped.'}).waitFor();
    assert.equal(
      await ai.locator('#active-model').textContent(),
      name,
      'Stop retains the loaded model',
    );
    await ai.locator('.retry').last().click();
    await ai.locator('#task-status').filter({hasText: 'Answer ready.'}).waitFor();
    const count = await ai.locator('.message').count();
    await ai.locator('#close').click();
    await page.locator('#prix-ai-panel').waitFor({state: 'hidden'});
    await page.locator('#prix-ai-launch').click();
    assert.equal(await ai.locator('.message').count(), count);
    assert.equal(await ai.locator('#active-model').textContent(), 'No model loaded');
    results.push({
      name,
      action,
      loadMs,
      answer,
      stoppedWithoutReload: true,
      retry: true,
      conversationRetained: true,
    });
    console.log(`PASS real UI ${name}: ${action}, answer, stop, retry, close/reopen`);
  }
  await context.setOffline(true);
  for (const name of ['Qwen3.5 2B', 'Gemma 4 E2B']) {
    await openModels();
    await ai.getByRole('button', {name: `Install or use ${name}`, exact: true}).click();
    await waitReady(name);
    await ai.locator('#send').click();
    await ai.locator('.message').last().locator('.compare').waitFor();
    assert.ok((await ai.locator('.answer').last().textContent()).trim());
    console.log(`PASS offline UI ${name}: cached model loaded and answered`);
  }
  await page.locator('#prix-ai-panel').screenshot({path: resolve(output, 'real-install-ui.png')});
  await writeFile(
    resolve(output, 'real-install.json'),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: context.browser().version(),
        manifest,
        results,
        offlineLoad: ['qwen', 'gemma'],
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (page) {
    console.error(
      await page
        .frameLocator('#prix-ai-panel iframe')
        .locator('body')
        .innerText({timeout: 1000})
        .catch(() => 'Panel unavailable'),
    );
    await page.screenshot({path: resolve(output, 'real-install-failure.png')}).catch(() => {});
  }
  throw error;
} finally {
  clearInterval(progress);
  await context?.close();
  await fixture.close();
  await preview.close();
}
