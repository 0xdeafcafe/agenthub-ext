// Load the production MV3 build in an isolated browser profile. All GitHub
// requests are fulfilled by our local fixture server; no account or network.
import assert from 'node:assert/strict';
import {mkdtemp, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {startPreview} from '../dev/server.mjs';
import {browserPath} from './browser.mjs';
import {startGithubFixture} from './github-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = resolve(root, process.env.PRIX_EXTENSION_DIR ?? '.output/chrome-mv3');
const preview = await startPreview({port: 0, watch: false});
const profile = await mkdtemp(join(tmpdir(), 'prix-local-extension-'));
const errors = [];
let workerDownloads = 0;
let fixture;
let context;
try {
  fixture = await startGithubFixture(preview.url, profile);
  context = await chromium.launchPersistentContext(profile, {
    executablePath: browserPath({extension: true}),
    headless: false,
    args: [
      '--headless=new',
      ...fixture.args,
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    viewport: {width: 1440, height: 1060},
    reducedMotion: 'reduce',
  });
  context.on('request', (request) => {
    if (
      request.url().startsWith('https://github.com/') &&
      request.url().endsWith('.diff') &&
      request.serviceWorker()
    )
      workerDownloads++;
  });
  const page = context.pages()[0];
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type()) && message.text().includes('[PR Impact]'))
      errors.push(message.text());
  });
  await mkdir(resolve(root, 'e2e/screenshots/local'), {recursive: true});
  await page.goto('https://github.com/acme/review-kit/pull/42?extension=1');
  await page.waitForFunction(() =>
    document.querySelector('.prix-coverage')?.textContent?.startsWith('Counted from the full diff'),
  );
  assert.equal(await page.locator('.fixture-file').count(), 0);
  assert.equal(await page.locator('#prix-bar').count(), 1);
  assert.equal(await page.locator('.prix-totals').textContent(), '8 files · 4,298 lines');
  assert.equal(
    await page.locator('#prix-bar input, #prix-bar .prix-chip, #prix-bar .prix-bar-footer').count(),
    0,
  );
  console.log('PASS production extension: PR overview and background inventory');
  for (const view of ['files', 'changes']) {
    await page.goto(`https://github.com/acme/review-kit/pull/42/${view}?extension=1&theme=dark`);
    await page.waitForFunction(
      () => document.querySelector('.prix-totals')?.textContent === '8 files · 4,298 lines',
    );
    await page.waitForFunction(() =>
      document
        .querySelector('.prix-coverage')
        ?.textContent?.startsWith('Counted from the full diff'),
    );
    await page.getByLabel('Exclude comment-only lines', {exact: true}).check();
    await page.waitForFunction(
      () => document.querySelector('.prix-totals')?.textContent === '8 files · 4,283 lines',
    );
    await page.getByLabel('Exclude comment-only lines', {exact: true}).uncheck();
    assert.equal(await page.locator('#prix-bar').count(), 1);
    assert.equal(await page.locator('.prix-badge').count(), 8);
    await page.getByRole('button', {name: 'Focus code', exact: true}).click();
    await page.waitForFunction(() => document.querySelectorAll('.prix-collapsed').length === 5);
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector('.prix-preset[title]')?.getAttribute('aria-pressed') === 'true',
    );
    assert.equal(
      await page
        .getByRole('button', {name: 'Focus code', exact: true})
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.evaluate(() => window.prixHarness.remount());
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(await page.locator('.prix-totals').textContent(), '8 files · 4,298 lines');
    await page.screenshot({
      path: resolve(root, `e2e/screenshots/local/extension-${view}-dark.png`),
    });
    console.log(`PASS production extension: ${view}, persistent filters, remounts, screenshot`);
  }
  await page.locator('#prix-ai-launch').click();
  const assistant = page.frameLocator('#prix-ai-panel iframe');
  await assistant.locator('#coverage').filter({hasText: '8 files'}).waitFor();
  await assistant.locator('#models-summary').filter({hasText: '0 of 2 installed'}).waitFor();
  await assistant.locator('#question').fill('next');
  await assistant.locator('#search').click();
  await assistant.locator('.sources .source').first().waitFor();
  await page
    .locator('#prix-ai-panel')
    .screenshot({path: resolve(root, 'e2e/screenshots/local/assistant-extension.png')});
  console.log(
    'PASS production assistant: extension iframe, background source index, packaged worker, local search',
  );
  await assistant.locator('#close').click();
  assert.ok(workerDownloads >= 2, 'the background worker requested both inventories');
  assert.equal(
    fixture.metrics.patchDownloads,
    workerDownloads,
    'every worker download followed the patch-host redirect',
  );
  await page.goto(
    'https://github.com/acme/review-kit/pull/42/changes?extension=1&mode=virtualization',
  );
  await page.waitForFunction(() =>
    document.querySelector('.prix-coverage')?.textContent?.startsWith('Counted from the full diff'),
  );
  await page.getByRole('button', {name: 'Focus code', exact: true}).click();
  await page.evaluate(() => window.prixHarness.virtualScroll(800));
  await page.waitForSelector('.fixture-native-toggle[aria-expanded="false"]');
  assert.equal(
    await page
      .locator('[data-virtualizer] #prix-bar, .prix-hidden-outer, .prix-collapsed-outer')
      .count(),
    0,
  );
  console.log('PASS production extension: virtualized native collapse without slot overrides');
  const popupOpened = context.waitForEvent('page', {timeout: 10_000});
  await page.getByRole('link', {name: 'Settings', exact: true}).click();
  const popup = await popupOpened;
  popup.setDefaultTimeout(10_000);
  await popup.locator('#enabled').uncheck();
  await page.waitForFunction(() => !document.querySelector('#prix-bar'));
  await popup.locator('#enabled').check();
  await page.waitForSelector('#prix-bar');
  await popup.locator('#exclude-comments').check();
  await popup.locator('#reset-repo').click();
  await page.waitForFunction(
    () => document.querySelector('.prix-totals')?.textContent === '8 files · 4,283 lines',
  );
  await popup.close();
  console.log('PASS production worker fallback, comment counting, popup, live storage changes');
  await page.evaluate(() => localStorage.setItem('prix-disabled', '1'));
  await page.reload();
  await page.locator('.fixture-file-header').first().waitFor();
  assert.equal(await page.locator('#prix-bar, .prix-badge, .prix-pulls-menu').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS production kill switch; no content-script errors');
} finally {
  await context?.close();
  await fixture?.close();
  await preview.close();
  await rm(profile, {recursive: true, force: true});
}
