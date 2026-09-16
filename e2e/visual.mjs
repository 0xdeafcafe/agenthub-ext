import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';
import {browserPath} from './browser.mjs';
import {startPreview} from '../dev/server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Chromium's native controls and text rasterization differ across platforms.
const baseline = resolve(root, 'e2e/baselines', process.platform);
const artifacts = resolve(root, 'e2e/screenshots/visual');
const update = process.argv.includes('--update');
const injectRegression = process.argv.includes('--inject-regression');
const preview = await startPreview({port: 0, watch: false});
const browser = await chromium.launch({executablePath: browserPath(), headless: true});
await mkdir(artifacts, {recursive: true});
if (update) await mkdir(baseline, {recursive: true});
const results = [];

async function compare(name, actual) {
  await writeFile(resolve(artifacts, `${name}-actual.png`), actual);
  if (update) {
    await writeFile(resolve(baseline, `${name}.png`), actual);
    results.push({name, ok: true, message: 'baseline updated'});
    return;
  }
  const expected = await readFile(resolve(baseline, `${name}.png`)).catch(() => null);
  if (!expected) {
    results.push({
      name,
      ok: false,
      message: 'missing baseline; review screenshots and run npm run test:visual:update',
    });
    return;
  }
  await writeFile(resolve(artifacts, `${name}-expected.png`), expected);
  const a = PNG.sync.read(actual);
  const b = PNG.sync.read(expected);
  if (a.width !== b.width || a.height !== b.height) {
    results.push({
      name,
      ok: false,
      message: `size changed: ${b.width}×${b.height} → ${a.width}×${a.height}`,
    });
    return;
  }
  const diff = new PNG({width: a.width, height: a.height});
  const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: 0.15,
    includeAA: false,
  });
  const ratio = changed / (a.width * a.height);
  const ok = ratio <= 0.002;
  if (!ok) await writeFile(resolve(artifacts, `${name}-diff.png`), PNG.sync.write(diff));
  results.push({name, ok, message: `${changed} changed pixels (${(ratio * 100).toFixed(3)}%)`});
}

async function stableFonts(page) {
  await page.addStyleTag({
    content: `@font-face {font-family: PrixVisual; src: url('${preview.url}/fonts/inter.woff2')} * {font-family: PrixVisual, sans-serif !important;} *, *::before, *::after {animation: none !important; transition: none !important; caret-color: transparent !important;}`,
  });
  await page.evaluate(async () => {
    await document.fonts.load('12px PrixVisual');
    await document.fonts.ready;
  });
}
async function capture(page, locator, name) {
  await page.mouse.move(0, 0);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await compare(name, await locator.screenshot({animations: 'disabled', caret: 'hide'}));
}

try {
  for (const theme of ['light', 'dark'])
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: {width, height: 1200},
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
        colorScheme: theme,
        locale: 'en-US',
      });
      const page = await context.newPage();
      await page.goto(`${preview.url}/acme/review-kit/pull/42/changes?theme=${theme}`);
      await page.waitForFunction(() =>
        document.querySelector('.prix-coverage')?.textContent?.startsWith('Complete PR inventory'),
      );
      await stableFonts(page);
      if (injectRegression)
        await page.addStyleTag({content: '.prix-bar {padding-top: 64px !important}'});
      await capture(page, page.locator('#prix-bar'), `panel-${theme}-${width}`);
      await page.getByLabel('Exclude comment-only lines', {exact: true}).check();
      await page.locator('.prix-change-map > summary').click();
      await page.getByRole('button', {name: /^Explore folder src,/}).click();
      await capture(page, page.locator('#prix-bar'), `map-${theme}-${width}`);
      if (width === 1440) {
        await page.getByRole('button', {name: 'File options', exact: true}).first().click();
        await capture(page, page.getByRole('dialog'), `file-options-${theme}`);
      }
      await context.close();
    }
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: {width: 400, height: 800},
      deviceScaleFactor: 1,
      colorScheme: theme,
      locale: 'en-US',
    });
    const page = await context.newPage();
    await page.goto(`${preview.url}/popup.html`);
    await page.waitForSelector('#category-defaults select');
    await stableFonts(page);
    await capture(page, page.locator('main'), `settings-${theme}`);
    await context.close();
  }
  if (update)
    await writeFile(
      resolve(baseline, 'environment.json'),
      JSON.stringify(
        {
          browser: browser.version(),
          font: '@fontsource/inter latin 400',
          threshold: 0.15,
          maxChangedRatio: 0.002,
        },
        null,
        2,
      ) + '\n',
    );
  await writeFile(
    resolve(artifacts, 'index.html'),
    `<!doctype html><html lang="en"><title>PR Impact visual regression</title><style>body{font:14px system-ui;background:#10141c;color:#e0e8f4;padding:24px}.images{display:flex;gap:12px;overflow:auto}img{max-width:45%;object-fit:contain;object-position:top}section{margin:24px 0}h2{font-size:16px}</style><h1>Visual regression review</h1>${results.map((result) => `<section><h2>${result.ok ? 'PASS' : 'FAIL'} ${result.name}</h2><p>${result.message}</p><div class="images">${!update ? `<img src="${result.name}-expected.png" alt="Expected">` : ''}<img src="${result.name}-actual.png" alt="Actual">${!result.ok && !result.message.startsWith('size') ? `<img src="${result.name}-diff.png" alt="Difference">` : ''}</div></section>`).join('')}</html>`,
  );
  for (const result of results)
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}: ${result.message}`);
  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    console.error(`${failed.length} visual regressions. Inspect e2e/screenshots/visual/index.html`);
    process.exitCode = 1;
  } else
    console.log(
      `${results.length} ${update ? 'baselines saved for review' : 'visual checks passed'}`,
    );
} finally {
  await browser.close();
  await preview.close();
}
