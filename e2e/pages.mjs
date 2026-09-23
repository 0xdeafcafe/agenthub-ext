import assert from 'node:assert/strict';
import {mkdir, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {startPreview} from '../dev/server.mjs';
import {browserPath} from './browser.mjs';
import files from '../dev/files.json' with {type: 'json'};

const output = resolve('e2e/screenshots/local');
await mkdir(output, {recursive: true});
await rm(resolve(output, 'pages-failure.png'), {force: true});
const preview = await startPreview({port: 0, watch: false});
const browser = await chromium.launch({executablePath: browserPath(), headless: true});
const page = await browser.newPage({
  viewport: {width: 1440, height: 1100},
  reducedMotion: 'reduce',
});
page.setDefaultTimeout(10_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'warning' && message.text().includes('[PR Impact]'))
    errors.push(message.text());
});
let checks = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  console.log(`PASS ${name}`);
  checks++;
};
const settle = () =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
const inventory = () =>
  page.waitForFunction(() =>
    document.querySelector('.prix-coverage')?.textContent?.startsWith('Counted from the full diff'),
  );

try {
  let releaseDiff;
  const diffGate = new Promise((resolve) => {
    releaseDiff = resolve;
  });
  await page.route('**/pull/42.diff', async (route) => {
    await diffGate;
    await route.continue();
  });
  await page.goto(`${preview.url}/acme/review-kit/pull/42`);
  await page.waitForFunction(
    () => document.querySelector('.prix-totals')?.textContent === '8 files · 4,298 lines',
  );
  check(
    'cold overview uses native totals while the diff downloads',
    (await page.locator('.prix-coverage').textContent()) === 'Loading category breakdown…' &&
      (await page.locator('.prix-overview-category').count()) === 0,
  );
  releaseDiff();
  await inventory();
  await page.unroute('**/pull/42.diff');
  const coldCategories = await page.locator('.prix-overview-category').allTextContents();
  check(
    'overview has no review controls or state labels',
    (await page
      .locator(
        '#prix-bar input, #prix-bar .prix-presets, #prix-bar .prix-chip, #prix-bar .prix-bar-footer',
      )
      .count()) === 0,
  );
  check(
    'overview joins the tabs with a compact full-width summary',
    await page.evaluate(() => {
      const tabs = document.querySelector('.fixture-pr-tabs').getBoundingClientRect();
      const bar = document.querySelector('#prix-bar').getBoundingClientRect();
      return (
        Math.abs(tabs.left - bar.left) < 1 &&
        Math.abs(tabs.width - bar.width) < 1 &&
        Math.abs(tabs.bottom - bar.top) < 1 &&
        bar.height < 180
      );
    }),
  );
  await page.screenshot({path: resolve(output, 'overview-summary.png')});
  await page.locator('#pull-requests-tab').hover();
  await page.locator('.prix-pulls-menu').waitFor();
  check(
    'Pull requests hover menu matches GitHub’s views, with nothing added to the nav',
    JSON.stringify(await page.locator('.prix-pulls-menu a').allTextContents()) ===
      JSON.stringify([
        'Pull requests',
        'Authored by me',
        'Assigned to me',
        'Involves me',
        'Review requests',
        'Milestones',
        'Labels',
      ]) && (await page.locator('.fixture-repo-nav > li').count()) === 4,
  );
  await page.screenshot({
    path: resolve(output, 'pulls-menu-light.png'),
    clip: {x: 0, y: 0, width: 520, height: 470},
  });
  await page.mouse.move(700, 900);
  await page.locator('.prix-pulls-menu').waitFor({state: 'detached'});
  await page.getByRole('button', {name: 'Light / dark', exact: true}).click();
  await page.screenshot({path: resolve(output, 'overview-summary-dark.png')});
  await page.locator('#pull-requests-tab').hover();
  await page.locator('.prix-pulls-menu').waitFor();
  await page.screenshot({
    path: resolve(output, 'pulls-menu-dark.png'),
    clip: {x: 0, y: 0, width: 520, height: 470},
  });
  await page.mouse.move(700, 900);
  await page.locator('.prix-pulls-menu').waitFor({state: 'detached'});
  check(
    'overview spans the wrapping GitHub header layout',
    await page.locator('#prix-bar').evaluate((el) => el.getBoundingClientRect().width > 1100),
  );
  check(
    'overview has full counts without any diff containers',
    (await page.locator('.prix-totals').textContent()) === '8 files · 4,298 lines' &&
      (await page.locator('.fixture-file').count()) === 0,
  );
  check(
    'panel sits between PR tabs and conversation',
    await page.evaluate(() => {
      const bar = document.querySelector('#prix-bar');
      return (
        !!(
          document.querySelector('.fixture-pr-tabs').compareDocumentPosition(bar) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ) &&
        !!(
          bar.compareDocumentPosition(document.querySelector('.fixture-conversation')) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      );
    }),
  );
  await page.locator('.prix-change-map > summary').click();
  await page.getByRole('button', {name: /^Explore folder docs,/}).click();
  await page.screenshot({path: resolve(output, 'overview-map.png')});
  await page.setViewportSize({width: 390, height: 1100});
  check(
    'overview panel fits a narrow viewport',
    await page
      .locator('#prix-bar')
      .evaluate(
        (el) => el.getBoundingClientRect().right <= innerWidth && el.scrollWidth <= el.clientWidth,
      ),
  );
  await page.screenshot({path: resolve(output, 'overview-mobile.png')});
  await page.setViewportSize({width: 1440, height: 1100});
  await page.getByRole('button', {name: /^Open file docs\/reviewing.md,/}).click();
  await page.waitForURL(`**/changes#${files[6].id}`);
  await page.locator(`#${files[6].id} .fixture-diff`).waitFor();
  check('overview map opens a filtered file at its GitHub anchor', true);
  await inventory();
  await page.getByLabel('Unreviewed only', {exact: true}).check();
  await page.getByRole('button', {name: 'Expand all categories', exact: true}).click();
  await page.goto(`${preview.url}/acme/review-kit/pull/42`);
  await inventory();
  check(
    'overview categories stay the same after visiting Changes and changing filters',
    JSON.stringify(await page.locator('.prix-overview-category').allTextContents()) ===
      JSON.stringify(coldCategories),
  );
  await page.goto(`${preview.url}/acme/review-kit/pull/42/changes`);
  await inventory();
  await page.getByLabel('Unreviewed only', {exact: true}).uncheck();
  await page.getByLabel('Exclude comment-only lines', {exact: true}).check();
  await page.goto(`${preview.url}/acme/review-kit/pull/42`);
  await inventory();
  check(
    'overview honors saved comment exclusion with an explicit label',
    (await page.locator('.prix-totals').textContent()) === '8 files · 4,283 lines' &&
      (await page.locator('.prix-coverage').textContent()).includes('comment-only lines excluded'),
  );
  await page.route('**/pull/42.diff', (route) => route.fulfill({status: 503, body: 'Unavailable'}));
  await page.goto(`${preview.url}/acme/review-kit/pull/42`);
  await page.waitForFunction(() =>
    document
      .querySelector('.prix-coverage')
      ?.textContent?.startsWith('Category breakdown and map unavailable'),
  );
  check(
    'failed overview download retains GitHub totals and hides the unavailable map',
    (await page.locator('.prix-totals').textContent()) === '8 files · 4,298 lines' &&
      !(await page.locator('.prix-change-map').isVisible()),
  );
  await page.unroute('**/pull/42.diff');

  await page.route('**/pull/42.diff', (route) => route.fulfill({status: 503, body: 'Unavailable'}));
  await page.goto(`${preview.url}/acme/review-kit/pull/42/changes?scenario=unmeasured`);
  await page.getByRole('button', {name: 'Retry full counts', exact: true}).waitFor();
  await page.locator('.prix-change-map > summary').click();
  // The details toggle event renders the map in a later browser task.
  await page.locator('.prix-map-row').first().waitFor();
  check(
    'unloaded files use file percentages, never bogus zero-line percentages',
    (await page.locator('.prix-totals').textContent()).includes('line counts incomplete') &&
      (await page.locator('.prix-chip-meta').allTextContents()).every((text) =>
        text.endsWith('% of files'),
      ),
  );
  check(
    'map distinguishes missing counts from genuine zero-line changes',
    (await page.locator('.prix-map-note').textContent()).includes('Area follows file counts') &&
      !(await page.locator('.prix-map-list').textContent()).includes('0 lines'),
  );
  await page.screenshot({path: resolve(output, 'map-unavailable.png')});
  await page.unroute('**/pull/42.diff');
  await page.getByRole('button', {name: 'Retry full counts', exact: true}).click();
  await inventory();
  check(
    'retry fills every map file without scrolling or visiting another page',
    !(await page.locator('.prix-map-list').textContent()).includes('unavailable') &&
      (await page.locator('.prix-totals').textContent()) === '8 files · 4,283 lines',
  );
  await page.goto(`${preview.url}/acme/review-kit/pull/42/changes`);
  await inventory();
  await page.evaluate(() => window.prixHarness.addFiles(250));
  await page.locator('.prix-change-map > summary').click();
  await page.getByLabel('Map folder depth', {exact: true}).waitFor();
  check(
    'large maps expose subfolders without an extra click',
    (await page.getByRole('button', {name: /^Explore folder src\/lazy,/}).count()) === 1,
  );
  await page.getByLabel('Map folder depth', {exact: true}).selectOption('1');
  check(
    'large map depth can return to top-level folders',
    (await page.getByRole('button', {name: /^Explore folder src,/}).count()) === 1,
  );

  await page.goto(`${preview.url}/acme/review-kit/pull/42/changes?mode=virtualization`);
  await inventory();
  await page.getByRole('button', {name: 'Focus code', exact: true}).click();
  await page.evaluate(() => window.prixHarness.virtualScroll(700));
  await settle();
  await settle();
  check(
    'virtualized filters use native collapse',
    (await page.locator('.fixture-native-toggle[aria-expanded="false"]').count()) > 0,
  );
  check(
    'virtualizer slots never get height overrides or display:none',
    (await page
      .locator(
        '[data-index].prix-collapsed-outer,[data-index].prix-hidden-outer,.fixture-file.prix-hidden,.fixture-file.prix-collapsed',
      )
      .count()) === 0,
  );
  check(
    'panel is outside the virtual scroller',
    (await page.locator('[data-virtualizer] #prix-bar').count()) === 0,
  );
  await page.getByRole('button', {name: 'Expand all categories', exact: true}).click();
  await settle();
  await page.evaluate(() => window.prixHarness.virtualScroll(0));
  await settle();
  const handle = await page.locator('.fixture-file').first().elementHandle();
  const firstPath = await handle.getAttribute('data-tagsearch-path');
  await page.evaluate(() => window.prixHarness.virtualScroll(1400));
  await settle();
  await settle();
  check(
    'fixture really reuses mounted DOM nodes for other paths',
    (await handle.getAttribute('data-tagsearch-path')) !== firstPath,
  );
  check(
    'recycled header has the correct category and counts stay stable',
    (await page.evaluate(() =>
      [...document.querySelectorAll('.fixture-file')].every((file) => {
        const path = file.getAttribute('data-tagsearch-path');
        const expected = path.startsWith('tests/')
          ? 'tests'
          : path.startsWith('specs/')
            ? 'specs'
            : path.startsWith('docs/')
              ? 'docs'
              : path === 'package-lock.json'
                ? 'generated'
                : 'code';
        return file.querySelector('.prix-badge')?.textContent === expected;
      }),
    )) && (await page.locator('.prix-totals').textContent()) === '8 files · 4,283 lines',
  );
  await page.getByRole('button', {name: 'Focus code', exact: true}).click();
  for (const top of [0, 450, 900, 0, 500, 1000, 0]) {
    await page.evaluate((top) => window.prixHarness.virtualScroll(top), top);
    await settle();
    await settle();
  }
  const before = await page.evaluate(() => ({
    ...window.prixHarness.virtualMetrics,
    scroll: document.querySelector('#fixture-files').scrollTop,
  }));
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    ...window.prixHarness.virtualMetrics,
    scroll: document.querySelector('#fixture-files').scrollTop,
  }));
  check(
    'scrolling settles without collapse/remount feedback loops',
    before.renders === after.renders &&
      before.nativeClicks === after.nativeClicks &&
      before.scroll === after.scroll,
  );
  const frames = await page.evaluate(async () => {
    const snapshot = () =>
      JSON.stringify({
        scroll: document.querySelector('#fixture-files').scrollTop,
        clicks: window.prixHarness.virtualMetrics.nativeClicks,
        panelHeight: document.querySelector('#prix-bar').getBoundingClientRect().height,
        files: [...document.querySelectorAll('.fixture-file')].map((file) => ({
          path: file.getAttribute('data-tagsearch-path'),
          top: file.getBoundingClientRect().top,
          height: file.getBoundingClientRect().height,
          expanded: file.querySelector('.fixture-native-toggle').getAttribute('aria-expanded'),
        })),
      });
    const samples = [snapshot()];
    for (let frame = 0; frame < 12; frame++) {
      window.prixHarness.rerenderHeader();
      document.dispatchEvent(new Event('soft-nav:react-done'));
      await new Promise(requestAnimationFrame);
      samples.push(snapshot());
    }
    return samples;
  });
  check(
    'stationary virtual files keep their heights and positions through header replacements',
    new Set(frames).size === 1,
  );
  await page.locator('.fixture-native-toggle[aria-expanded="true"]').first().click();
  await settle();
  await settle();
  check(
    'manual native collapse is respected',
    (await page.locator('.fixture-native-toggle[aria-expanded="false"]').count()) > 0,
  );
  await page.locator('.prix-change-map > summary').click();
  await page.evaluate(() => document.dispatchEvent(new Event('soft-nav:react-done')));
  await settle();
  check(
    'same-URL React events preserve the open map and overrides',
    (await page.locator('.prix-change-map').getAttribute('open')) !== null &&
      (await page.locator('.prix-filter-reset').first().isVisible()),
  );
  await page.evaluate(() => document.querySelector('#prix-bar').remove());
  await page.waitForSelector('#prix-bar');
  check(
    'removed panel remounts exactly once outside virtual content',
    (await page.locator('#prix-bar').count()) === 1 &&
      (await page.locator('[data-virtualizer] #prix-bar').count()) === 0,
  );
  await page.getByRole('button', {name: /^Explore folder docs,/}).click();
  await page.getByRole('button', {name: /^Open file docs\/reviewing.md,/}).click();
  await page.locator(`#${files[6].id} .fixture-diff`).waitFor();
  check('map reveals an unmounted virtualized file through native navigation', true);
  await settle();
  await settle();
  await page.keyboard.press('Shift+K');
  await page.locator(`#${files[5].id} .fixture-diff`).waitFor();
  check('virtualized keyboard navigation uses the complete file inventory', true);
  await page.screenshot({path: resolve(output, 'virtualization-map.png')});
  check('no runtime errors or extension warnings', errors.length === 0);
  console.log(`${checks} overview and virtualization checks passed`);
} catch (error) {
  await page.screenshot({path: resolve(output, 'pages-failure.png')}).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await preview.close();
}
