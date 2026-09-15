import assert from 'node:assert/strict';
import {mkdir, writeFile, rm, readdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {startPreview} from '../dev/server.mjs';
import {browserPath} from './browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'e2e/screenshots/local');
await mkdir(output, {recursive: true});
const preview = await startPreview({port: 0, watch: false});
let browser;
let page;
const shots = [];
const errors = [];
let checks = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  checks++;
  console.log(`PASS ${name}`);
};
const pathFor = (view) => `/acme/review-kit/pull/42/${view === 'react' ? 'changes' : 'files'}`;
const idFor = (i) => `#diff-${(i + 1).toString(16).padStart(32, '0')}`;
const settle = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
const waitFiles = (page, count) =>
  page.waitForFunction(
    (n) => document.querySelector('.prix-totals')?.textContent?.startsWith(`${n} files ·`),
    count,
  );

async function open(view, theme = 'light', width = 1440) {
  const context = await browser.newContext({
    viewport: {width, height: 1060},
    reducedMotion: 'reduce',
    colorScheme: theme,
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: preview.url});
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type()) && message.text().includes('[PR Impact]'))
      errors.push(message.text());
  });
  await page.goto(`${preview.url}${pathFor(view)}?theme=${theme}`);
  await waitFiles(page, 8);
  return context;
}

async function shot(name, locator) {
  await settle(page);
  await (locator ?? page).screenshot({
    path: resolve(output, `${name}.png`),
    animations: 'disabled',
  });
  shots.push(name);
}

try {
  browser = await chromium.launch({executablePath: browserPath(), headless: true});
  for (const view of ['classic', 'react']) {
    const context = await open(view);
    console.log(`\n${view.toUpperCase()} fixtures`);
    const totals = await page.locator('.prix-totals').textContent();
    check('counts all files and comma-separated diff stats', totals === '8 files · 4298 lines');
    check('exactly one panel', (await page.locator('#prix-bar').count()) === 1);
    check(
      'default view expands code',
      (await page.locator('.prix-chip[data-category="code"]').getAttribute('data-state')) ===
        'visible',
    );
    check(
      'hidden files take no space',
      await page.locator(idFor(7)).evaluate((el) => el.getBoundingClientRect().height === 0),
    );
    check(
      'collapsed file keeps its header',
      await page.locator(`${idFor(3)} .fixture-file-header`).isVisible(),
    );
    check(
      'collapsed diff body is hidden',
      !(await page.locator(`${idFor(3)} .fixture-diff`).isVisible()),
    );
    await shot(`${view}-light-wide`);
    await shot(`${view}-panel`, page.locator('#prix-bar'));

    for (const state of ['visible', 'collapsed', 'hidden']) {
      await page.locator('.prix-chip[data-category="docs"]').click();
      await settle(page);
      check(
        `docs cycles to ${state}`,
        (await page.locator('.prix-chip[data-category="docs"]').getAttribute('data-state')) ===
          state,
      );
      check(
        `docs DOM follows ${state}`,
        await page
          .locator(idFor(6))
          .evaluate(
            (el, state) =>
              el.classList.contains('prix-hidden') === (state === 'hidden') &&
              el.classList.contains('prix-collapsed') === (state === 'collapsed'),
            state,
          ),
      );
    }
    await page.getByRole('button', {name: 'Focus code', exact: true}).click();
    await settle(page);
    check(
      'focus preset is selected',
      (await page
        .getByRole('button', {name: 'Focus code', exact: true})
        .getAttribute('aria-pressed')) === 'true',
    );
    check(
      'focus keeps other file headers accessible',
      (await page.locator('.prix-chip[data-state="collapsed"]').count()) === 4,
    );
    await page.getByRole('button', {name: 'Expand all categories', exact: true}).click();
    await settle(page);
    check(
      'show all restores every diff',
      (await page.locator('.prix-hidden, .prix-collapsed').count()) === 0,
    );

    await page.evaluate(() => window.prixHarness.remount());
    await settle(page);
    check(
      'remount does not double-count files',
      (await page.locator('.prix-totals').textContent()) === totals,
    );
    await page.evaluate(() => window.prixHarness.rerenderHeader());
    await settle(page);
    check(
      'replacement header gets one badge',
      (await page.locator(`${idFor(0)} .prix-badge`).count()) === 1,
    );

    await page
      .locator(
        view === 'react'
          ? `${idFor(0)} button.MarkAsViewedButton-fixture`
          : `${idFor(0)} .js-reviewed-checkbox`,
      )
      .click();
    await page.waitForFunction(() =>
      document.querySelector('.prix-totals')?.textContent?.includes('1 reviewed'),
    );
    check(
      'reviewed state updates immediately',
      (await page.locator('.prix-progress').getAttribute('aria-valuetext')) ===
        '1 of 8 files reviewed',
    );

    await page.getByRole('button', {name: 'Copy impact report as markdown', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'Report copied'}).waitFor();
    check(
      'report reaches the clipboard',
      (await page.evaluate(() => navigator.clipboard.readText())).includes(
        '| code | 3 | +249 | -55 |',
      ),
    );
    await page.evaluate(() =>
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: () => Promise.reject(new Error('denied')),
      }),
    );
    await page.getByRole('button', {name: 'Copy impact report as markdown', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'Couldn’t copy'}).waitFor();
    check(
      'clipboard rejection has useful feedback',
      !(await page
        .getByRole('button', {name: 'Copy impact report as markdown', exact: true})
        .isDisabled()),
    );

    await page.evaluate((view) => window.prixHarness.navigate(view), view);
    await waitFiles(page, 8);
    await page.evaluate(() => {
      document.dispatchEvent(new Event('turbo:render'));
      document.dispatchEvent(new Event('turbo:render'));
    });
    await settle(page);
    check(
      'repeated soft-nav events keep one panel',
      (await page.locator('#prix-bar').count()) === 1,
    );
    await page.getByRole('button', {name: 'Expand all categories', exact: true}).click();
    await settle(page);
    await page.locator(idFor(0)).evaluate((el) => el.scrollIntoView({block: 'start'}));
    await page.keyboard.press('Shift+J');
    check(
      'one key press jumps one file after navigation',
      await page.locator(idFor(1)).evaluate((el) => el.classList.contains('prix-flash')),
    );
    await page.keyboard.press('Shift+K');
    check(
      'previous-file shortcut returns',
      await page.locator(idFor(0)).evaluate((el) => el.classList.contains('prix-flash')),
    );
    await page.evaluate(() => {
      const editor = document.createElement('div');
      editor.contentEditable = 'plaintext-only';
      document.body.append(editor);
      editor.focus();
    });
    await page.keyboard.press('Shift+J');
    check(
      'shortcuts leave text editors alone',
      await page.locator(idFor(0)).evaluate((el) => el.classList.contains('prix-flash')),
    );

    await page.getByRole('button', {name: 'Collapse all categories', exact: true}).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.keyboard.press('Shift+J');
    await page.keyboard.press('Shift+J');
    check(
      'repeated jumps advance through a short collapsed diff',
      await page.locator(idFor(1)).evaluate((el) => el.classList.contains('prix-flash')),
    );
    await page.evaluate(() => window.prixHarness.addFiles());
    await waitFiles(page, 9);
    check(
      'lazy files inherit the active state',
      await page.locator(idFor(8)).evaluate((el) => el.classList.contains('prix-collapsed')),
    );
    const started = performance.now();
    await page.evaluate(() => window.prixHarness.addFiles(250));
    await waitFiles(page, 259);
    const elapsed = Math.round(performance.now() - started);
    check('250-file batch settles within 5 seconds', elapsed < 5000);
    console.log(`  Mounted and classified 250 files in ${elapsed} ms (includes fixture rendering)`);
    await context.close();
  }

  for (const view of ['classic', 'react']) {
    for (const [theme, width, size] of [
      ['dark', 1440, 'wide'],
      ['light', 390, 'narrow'],
      ['dark', 390, 'narrow'],
    ]) {
      const context = await open(view, theme, width);
      check(
        `${view} ${theme} ${size} panel stays within viewport`,
        await page.locator('#prix-bar').evaluate((el) => {
          const box = el.getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth;
        }),
      );
      check(
        `${view} ${theme} ${size} controls stay within panel`,
        await page.locator('#prix-bar').evaluate((el) => {
          const box = el.getBoundingClientRect();
          return [...el.querySelectorAll('button:not([hidden])')].every((button) => {
            const rect = button.getBoundingClientRect();
            return rect.left >= box.left && rect.right <= box.right;
          });
        }),
      );
      await shot(`${view}-${theme}-${size}`);
      await context.close();
    }
  }
  check('no content-script errors or warnings', errors.length === 0);
  await rm(resolve(output, 'failure.png'), {force: true});
  const gallery = (await readdir(output))
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => name.slice(0, -4));
  await writeFile(
    resolve(output, 'index.html'),
    `<!doctype html><html lang="en"><title>PR Impact screenshots</title><style>body{font:14px system-ui;background:#10141c;color:#dde5f0;padding:32px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:24px}a{color:#8db9ff}img{width:100%;border:1px solid #303947;border-radius:8px}</style><h1>PR Impact · Visual review</h1><p>${checks} browser checks passed. Generated ${new Date().toISOString()}.</p><main>${gallery.map((name) => `<a href="${name}.png"><h3>${name}</h3><img src="${name}.png" alt="${name}"></a>`).join('')}</main></html>`,
  );
  console.log(
    `\n${checks} checks passed. ${shots.length} screenshots: e2e/screenshots/local/index.html`,
  );
} catch (error) {
  if (page && !page.isClosed())
    await page.screenshot({path: resolve(output, 'failure.png')}).catch(() => {});
  console.error(errors);
  throw error;
} finally {
  await browser?.close();
  await preview.close();
}
