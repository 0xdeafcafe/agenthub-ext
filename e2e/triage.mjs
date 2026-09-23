import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {startPreview} from '../dev/server.mjs';
import {browserPath} from './browser.mjs';

// classifier.dev is stubbed; the check is what leaves the browser and when.
const preview = await startPreview({port: 0, watch: false});
const browser = await chromium.launch({executablePath: browserPath(), headless: true});
const page = await browser.newPage({viewport: {width: 1440, height: 1050}});
const errors = [];
const sent = [];
let limited = false;
page.on('pageerror', (error) => errors.push(error.message));
await page.route('https://classifier.dev/**', async (route) => {
  const body = route.request().postDataJSON();
  sent.push(body);
  if (limited)
    return route.fulfill({
      status: 429,
      headers: {
        'Retry-After': '30',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Retry-After',
      },
      json: {code: 'rate_limit_minute', error: 'slow down'},
    });
  const verdicts = [
    ['behaviour change', 'authentication or permissions', 0.91],
    ['behaviour change', 'error handling', 0.74],
  ];
  return route.fulfill({
    headers: {'Access-Control-Allow-Origin': '*'},
    json: {
      model: 'jev-test',
      results: body.items.map((_item, i) => {
        const [change, risk, confidence] = verdicts[i] ?? [
          'refactor with no behaviour change',
          'low risk',
          0.8,
        ];
        return {dimensions: {change: {label: change, confidence}, risk: {label: risk, confidence}}};
      }),
    },
  });
});
const shot = (name) =>
  page.locator('#prix-ai-panel').screenshot({path: `e2e/screenshots/local/triage-${name}.png`});
try {
  await mkdir('e2e/screenshots/local', {recursive: true});
  for (const theme of ['dark', 'light']) {
    const before = sent.length;
    await page.goto(`${preview.url}/acme/review-kit/pull/42/changes?theme=${theme}`);
    await page.locator('#prix-ai-launch').click();
    const ai = page.frameLocator('#prix-ai-panel iframe');
    await ai.locator('#coverage').filter({hasText: '8 files'}).waitFor();
    const triage = ai.getByRole('button', {name: 'Triage', exact: true});
    await triage.click();
    await ai.locator('.triage-consent').waitFor();
    assert.equal(sent.length, before, 'nothing leaves the browser before consent');
    if (theme === 'dark') {
      await ai.getByRole('button', {name: 'Cancel', exact: true}).click();
      assert.equal(sent.length, before, 'cancel sends nothing');
      assert.match(await ai.locator('#task-status').textContent(), /Nothing was sent/);
      await triage.click();
    }
    await ai.getByRole('button', {name: /^Send \d+ files?$/}).click();
    await ai.locator('.triage-group').first().waitFor();
    const paths = sent.at(-1).items.map((item) => item.split('\n')[0]);
    assert.ok(paths.length > 0);
    assert.ok(
      paths.every((line) => !/test|spec|\.md|\.feature|lock/.test(line)),
      `only code files are sent: ${paths.join(', ')}`,
    );
    assert.deepEqual(Object.keys(sent.at(-1).dimensions), ['change', 'risk']);
    assert.match(
      await ai.locator('.triage-group h3').first().textContent(),
      /^Authentication or permissions/,
    );
    await shot(theme);
    await ai.locator('.triage-row button').first().click();
    await page.waitForFunction(() => location.hash.startsWith('#diff-'));
    if (theme === 'dark') {
      limited = true;
      await ai.getByRole('button', {name: 'Retry', exact: true}).click();
      await ai.locator('.answer-warning').filter({hasText: 'Try again in 30s'}).waitFor();
      limited = false;
    }
    await ai.locator('#close').click();
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS triage: consent before sending, cancel sends nothing, only code files leave, grouped by risk, opens files, rate-limit copy, both themes',
  );
} finally {
  await browser.close();
  await preview.close();
}
