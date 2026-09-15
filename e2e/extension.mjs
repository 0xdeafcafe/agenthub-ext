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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = resolve(root, '.output/chrome-mv3');
const preview = await startPreview({port: 0, watch: false});
const profile = await mkdtemp(join(tmpdir(), 'prix-local-extension-'));
const errors = [];
let workerDownloads = 0;
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: browserPath({extension: true}),
    headless: false,
    args: [
      '--headless=new',
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    viewport: {width: 1440, height: 1060},
    reducedMotion: 'reduce',
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.hostname !== 'github.com') return route.abort();
    if (url.pathname.endsWith('.diff')) {
      if (!route.request().serviceWorker()) {
        // Public GitHub diffs redirect; force the real worker fallback here.
        return route.fulfill({
          status: 302,
          headers: {
            location: 'https://patch-diff.githubusercontent.com/raw/acme/review-kit/pull/42.diff',
          },
        });
      }
      workerDownloads++;
    }
    if (url.pathname === '/__events')
      return route.fulfill({status: 200, contentType: 'text/event-stream', body: ': fixture\n\n'});
    const response = await route.fetch({url: `${preview.url}${url.pathname}${url.search}`});
    await route.fulfill({response});
  });
  const page = context.pages()[0];
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type()) && message.text().includes('[PR Impact]'))
      errors.push(message.text());
  });
  await mkdir(resolve(root, 'e2e/screenshots/local'), {recursive: true});
  for (const view of ['files', 'changes']) {
    await page.goto(`https://github.com/acme/review-kit/pull/42/${view}?extension=1&theme=dark`);
    await page.waitForFunction(
      () => document.querySelector('.prix-totals')?.textContent === '8 files · 4298 lines',
    );
    await page.waitForFunction(() =>
      document.querySelector('.prix-coverage')?.textContent?.startsWith('Complete PR inventory'),
    );
    await page.getByLabel('Exclude comment-only lines', {exact: true}).check();
    await page.waitForFunction(
      () => document.querySelector('.prix-totals')?.textContent === '8 files · 4283 lines',
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
    assert.equal(await page.locator('.prix-totals').textContent(), '8 files · 4298 lines');
    await page.screenshot({
      path: resolve(root, `e2e/screenshots/local/extension-${view}-dark.png`),
    });
    console.log(`PASS production extension: ${view}, persistent filters, remounts, screenshot`);
  }
  assert.ok(workerDownloads >= 2, 'the background worker downloaded both inventories');
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
    () => document.querySelector('.prix-totals')?.textContent === '8 files · 4283 lines',
  );
  await popup.close();
  console.log('PASS production worker fallback, comment counting, popup, live storage changes');
  await page.evaluate(() => localStorage.setItem('prix-disabled', '1'));
  await page.reload();
  await page.locator('.fixture-file-header').first().waitFor();
  assert.equal(await page.locator('#prix-bar, .prix-badge, #my-prs-repo-tab').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS production kill switch; no content-script errors');
} finally {
  await context?.close();
  await preview.close();
  await rm(profile, {recursive: true, force: true});
}
