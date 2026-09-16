import fixtureFiles from '../dev/files.json' with {type: 'json'};
import assert from 'node:assert/strict';
import {mkdir, rm} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {browserPath} from './browser.mjs';
import {startPreview} from '../dev/server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'e2e/screenshots/local');
await mkdir(output, {recursive: true});
await rm(resolve(output, 'features-failure.png'), {force: true});
const preview = await startPreview({port: 0, watch: false});
const browser = await chromium.launch({executablePath: browserPath(), headless: true});
let page;
const errors = [];
let checks = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  console.log(`PASS ${name}`);
  checks++;
};
const id = (i) => `#${fixtureFiles[i]?.id ?? `diff-${(i + 1).toString(16).padStart(32, '0')}`}`;
const settle = () =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
const waitTotal = (count) =>
  page.waitForFunction(
    (count) => document.querySelector('.prix-totals')?.textContent?.includes(`${count} lines`),
    count,
  );

async function open(view, scenario = '') {
  const context = await browser.newContext({
    viewport: {width: 1440, height: 1150},
    reducedMotion: 'reduce',
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: preview.url});
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('[PR Impact]'))
      errors.push(message.text());
  });
  await page.goto(`${preview.url}/acme/review-kit/pull/42/${view}?scenario=${scenario}`);
  await page.waitForSelector('#prix-bar');
  return context;
}
async function fileOption(i, label, value) {
  await page.locator(id(i)).getByRole('button', {name: 'File options', exact: true}).click();
  await page.getByRole('dialog').getByLabel(label).selectOption(value);
  await settle();
}

try {
  for (const view of ['files', 'changes']) {
    const context = await open(view);
    await page.waitForFunction(() =>
      document.querySelector('.prix-coverage')?.textContent?.startsWith('Complete PR inventory'),
    );
    check(
      `${view}: complete inventory before scrolling`,
      (await page.locator('.prix-totals').textContent()) === '8 files · 4298 lines',
    );
    await page.getByLabel('Exclude comment-only lines', {exact: true}).check();
    await waitTotal(4283);
    check(
      'comment-only lines excluded, inline code retained',
      (await page.locator('.prix-coverage').textContent()).includes(
        '15 comment-only lines excluded',
      ),
    );
    await page.getByRole('button', {name: 'Copy impact report as markdown', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'Report copied'}).waitFor();
    check(
      'clipboard uses adjusted counts',
      (await page.evaluate(() => navigator.clipboard.readText())).includes(
        '| code | 3 | +243 | -52 |',
      ),
    );

    await fileOption(3, 'Visibility for this file', 'visible');
    check(
      'one file can expand without changing its category',
      !(await page.locator(id(3)).evaluate((el) => el.classList.contains('prix-collapsed'))) &&
        (await page.locator(id(4)).evaluate((el) => el.classList.contains('prix-collapsed'))),
    );
    await fileOption(3, 'Visibility for this file', 'hidden');
    check(
      'one file can be hidden independently',
      await page.locator(id(3)).evaluate((el) => el.classList.contains('prix-hidden')),
    );
    await page.locator('.prix-change-map > summary').click();
    await page.getByRole('button', {name: /^Explore folder tests,/}).click();
    await page.getByRole('button', {name: /^Open file tests\/review.test.ts,/}).click();
    await settle();
    check('map reveals a hidden file', await page.locator(`${id(3)} .fixture-diff`).isVisible());

    await page
      .locator('.prix-map-breadcrumbs')
      .getByRole('button', {name: 'All changes', exact: true})
      .click();
    await page.getByRole('button', {name: /^Explore folder src,/}).click();
    check(
      'map drills into directory clusters',
      (await page.getByRole('button', {name: /^Explore folder src\/components,/}).count()) === 1,
    );
    await page.getByRole('button', {name: 'Focus this folder', exact: true}).click();
    await settle();
    check(
      'folder focus filters the diff',
      await page.locator(id(3)).evaluate((el) => el.classList.contains('prix-hidden')),
    );
    await page.getByLabel('Unreviewed only', {exact: true}).check();
    await page.locator('.prix-saved-views > summary').click();
    await page.getByLabel('New preset name').fill('Frontend review');
    await page.getByRole('button', {name: 'Save current view', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'Saved “Frontend review”'}).waitFor();
    await page.getByRole('button', {name: 'Expand all categories', exact: true}).click();
    await page.getByLabel('Exclude comment-only lines', {exact: true}).uncheck();
    await page.getByLabel('Saved review preset').selectOption('Frontend review');
    await settle();
    check(
      'saved view restores folder, comment, and unreviewed filters',
      (await page.getByLabel('Unreviewed only', {exact: true}).isChecked()) &&
        (await page.getByLabel('Exclude comment-only lines', {exact: true}).isChecked()) &&
        (await page
          .getByRole('button', {name: 'src/ · clear folder focus', exact: true})
          .isVisible()),
    );
    check(
      'restored folder focus synchronizes map breadcrumbs',
      (await page.locator('.prix-map-breadcrumbs').textContent()) === 'All changes / src',
    );
    await page.getByRole('button', {name: 'src/ · clear folder focus', exact: true}).click();
    await settle();
    check(
      'clearing folder focus resets the map',
      (await page.locator('.prix-map-breadcrumbs').textContent()) === 'All changes',
    );
    await page.getByRole('button', {name: /^Explore folder src,/}).click();
    await page.getByRole('button', {name: 'Focus this folder', exact: true}).click();
    await settle();
    await page.locator('.fixture-tree a').filter({hasText: 'docs/reviewing.md'}).click();
    await settle();
    check(
      'file tree reveals a file outside the focused folder',
      (await page.locator(`${id(6)} .fixture-diff`).isVisible()) &&
        (await page.locator('.prix-map-breadcrumbs').textContent()) === 'All changes',
    );
    await page.getByRole('button', {name: /^Explore folder src,/}).click();
    await page.getByRole('button', {name: 'Focus this folder', exact: true}).click();
    await settle();
    await page
      .locator('.prix-map-breadcrumbs')
      .getByRole('button', {name: 'All changes', exact: true})
      .click();
    await settle();
    check(
      'All changes clears the diff folder filter too',
      await page.locator(`${id(6)} .fixture-diff`).isVisible(),
    );
    await page.getByRole('button', {name: 'Expand all categories', exact: true}).click();
    await fileOption(0, 'Category for this file', 'docs');
    check(
      'classification correction updates the file badge',
      (await page.locator(`${id(0)} .prix-badge`).textContent()) === 'docs',
    );
    await page.locator(id(0)).getByRole('button', {name: 'File options', exact: true}).click();
    check(
      'classification explanation identifies the override',
      (
        await page.getByRole('dialog').locator('.prix-classification-reason').textContent()
      ).includes('repository override'),
    );
    await page.getByRole('dialog').getByLabel('Category for this file').selectOption('');
    await settle();
    check(
      'classification can return to matching rules',
      (await page.locator(`${id(0)} .prix-badge`).textContent()) === 'code',
    );
    await page
      .locator(
        view === 'files'
          ? `${id(0)} .js-reviewed-checkbox`
          : `${id(0)} .MarkAsViewedButton-fixture`,
      )
      .click();
    await page.getByLabel('Unreviewed only', {exact: true}).check();
    await settle();
    check(
      'unreviewed mode hides completed files',
      await page.locator(id(0)).evaluate((el) => el.classList.contains('prix-hidden')),
    );
    await page.getByLabel('Unreviewed only', {exact: true}).uncheck();
    await settle();
    check('completed files can be restored', await page.locator(id(0)).isVisible());

    await page.reload();
    await page.waitForSelector('#prix-bar');
    await page.locator('.prix-saved-views > summary').click();
    check(
      'saved views survive reloads',
      (await page.locator('.prix-saved-controls option[value="Frontend review"]').count()) === 1,
    );
    await page.getByLabel('Saved review preset').selectOption('Frontend review');
    await settle();
    await page.locator('.prix-change-map > summary').click();
    await page.locator('#prix-bar').screenshot({path: resolve(output, `features-${view}-map.png`)});

    const popup = await context.newPage();
    await popup.goto(`${preview.url}/popup.html`);
    await popup.getByRole('switch', {name: /Enable PR Impact/}).waitFor();
    await popup.getByRole('switch', {name: /Enable PR Impact/}).uncheck();
    await page.waitForFunction(() => !document.querySelector('#prix-bar'));
    check(
      'settings disable removes all filtering immediately',
      (await page.locator('.prix-hidden, .prix-collapsed, .prix-file-controls').count()) === 0,
    );
    await popup.getByRole('switch', {name: /Enable PR Impact/}).check();
    await page.waitForSelector('#prix-bar');
    check(
      'settings re-enable the extension immediately',
      (await page.locator('#prix-bar').count()) === 1,
    );
    await popup.getByRole('button', {name: 'Reset this repository', exact: true}).click();
    await page.waitForFunction(
      () => !document.querySelector('.prix-saved-controls option[value="Frontend review"]'),
    );
    check(
      'settings reset clears repository views',
      (await page.locator('.prix-saved-controls option[value="Frontend review"]').count()) === 0,
    );
    await popup.screenshot({path: resolve(output, `features-${view}-settings.png`)});
    await context.close();
  }

  for (const view of ['files', 'changes']) {
    const context = await open(view, 'virtualized');
    await page.waitForFunction(() =>
      document.querySelector('.prix-coverage')?.textContent?.startsWith('Complete PR inventory'),
    );
    check(
      'full inventory counts unmounted files',
      (await page.locator('.prix-badge').count()) === 3 &&
        (await page.locator('.prix-totals').textContent()) === '8 files · 4298 lines',
    );
    await page.locator('.prix-change-map > summary').click();
    await page.getByRole('button', {name: /^Explore folder docs,/}).click();
    await page.getByRole('button', {name: /^Open file docs\/reviewing.md,/}).click();
    await page.locator(`${id(6)} .prix-badge`).waitFor();
    check(
      'map opens an unmounted file through the GitHub tree',
      await page.locator(id(6)).isVisible(),
    );
    check(
      'inventory does not double-count newly mounted files',
      (await page.locator('.prix-totals').textContent()) === '8 files · 4298 lines',
    );
    await context.close();
  }
  const partial = await open('files', 'partial');
  await page.waitForFunction(() =>
    document.querySelector('.prix-coverage')?.textContent?.includes('Full diff unavailable'),
  );
  check(
    'failed full-inventory fetch is explicitly labeled',
    !(await page.locator('.prix-coverage').textContent()).includes('Complete PR inventory'),
  );
  await partial.close();
  check('no feature errors or warnings', errors.length === 0);
  console.log(`\n${checks} feature checks passed`);
} catch (error) {
  if (page && !page.isClosed())
    await page.screenshot({path: resolve(output, 'features-failure.png')}).catch(() => {});
  console.error(errors);
  throw error;
} finally {
  await browser.close();
  await preview.close();
}
