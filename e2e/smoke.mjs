// PR Impact — live smoke test against github.com (unauthenticated, public repos).
// Uses Chrome for Testing from the Playwright cache (branded Chrome >= 137
// ignores --load-extension; Arc refuses CDP launches). No browser downloads.
//
// Run: npm run test:e2e   (requires `npm run build` first)

import {mkdtempSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = path.join(root, '.output', 'chrome-mv3');
const screenshotsDir = path.join(root, 'e2e', 'screenshots');
mkdirSync(screenshotsDir, {recursive: true});

const results = [];
function check(name, condition, detail = '') {
  results.push({name, ok: Boolean(condition), detail});
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page, name) {
  const file = path.join(screenshotsDir, name);
  await page.screenshot({path: file, fullPage: false});
  console.log(`  screenshot: e2e/screenshots/${name}`);
}

const CFT = path.join(
  process.env.HOME,
  'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);
const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'prix-profile-')), {
  executablePath: CFT,
  headless: false,
  args: [
    '--headless=new',
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
  viewport: {width: 1440, height: 1000},
});

try {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: 'https://github.com'});
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(30_000);

  // ── 1. My PRs tab ────────────────────────────────────────────────────────
  console.log('\n== My PRs tab ==');
  await page.goto('https://github.com/refined-github/refined-github', {waitUntil: 'domcontentloaded'});
  await page.waitForSelector('a#pull-requests-tab, a#pull-requests-repo-tab');

  // This is also the extension-loaded check: only our content script adds this id.
  await page.waitForSelector('#my-prs-repo-tab', {timeout: 15_000});

  const tabInfo = await page.evaluate(() => {
    const mine = document.getElementById('my-prs-repo-tab');
    const prs = document.querySelector('a#pull-requests-tab, a#pull-requests-repo-tab');
    const liOf = el => el?.closest('li');
    return {
      href: mine?.getAttribute('href'),
      label: mine?.textContent?.trim(),
      rightAfterPrTab: liOf(prs)?.nextElementSibling === liOf(mine),
      hasCounter: Boolean(mine?.querySelector('.Counter, [class*="Counter"]')),
    };
  });
  check('tab exists', Boolean(tabInfo.href));
  check('tab labelled "My PRs"', tabInfo.label === 'My PRs', JSON.stringify(tabInfo.label));
  check('tab sits right after Pull requests tab', tabInfo.rightAfterPrTab);
  check('tab has no cloned Counter', !tabInfo.hasCounter);
  const query = new URLSearchParams(tabInfo.href?.split('?')[1] ?? '');
  check('tab href decodes to author:@me query', query.get('q') === 'is:pr is:open author:@me', tabInfo.href);

  // Logged out, the author:@me count fetch redirects and must yield NO count
  await page.waitForTimeout(2500);
  const myCount = await page.evaluate(
    () => document.querySelector('#my-prs-repo-tab .prix-counter')?.textContent ?? null,
  );
  check('no count badge when logged out (graceful)', myCount === null, `counter=${myCount}`);
  await shot(page, '01-my-prs-tab.png');

  // Logged-out GitHub 302-redirects author:@me to /pulls/@me, so a real
  // navigation can never keep the author:@me URL. Exercise the selected-state
  // path by spoofing the URL on the plain /pulls page and re-running init.
  const landed = await page.goto(`https://github.com${tabInfo.href}`, {waitUntil: 'domcontentloaded'});
  await page.waitForTimeout(2000);
  console.log(`  my-prs href status=${landed?.status()} landed on: ${page.url()}`);

  await page.goto('https://github.com/refined-github/refined-github/pulls', {waitUntil: 'domcontentloaded'});
  await page.waitForSelector('#my-prs-repo-tab', {timeout: 15_000});
  await page.evaluate(() => {
    history.replaceState(null, '', '/refined-github/refined-github/pulls?q=is%3Apr+is%3Aopen+author%3A%40me');
    document.dispatchEvent(new Event('turbo:render'));
  });
  await page.waitForTimeout(500);
  const selected = await page.evaluate(() => {
    const read = el => ({
      ariaCurrent: el?.getAttribute('aria-current') ?? null,
      selectedClass: el?.classList.contains('selected') ?? null,
    });
    return {
      mine: read(document.getElementById('my-prs-repo-tab')),
      prs: read(document.querySelector('a#pull-requests-tab, a#pull-requests-repo-tab')),
    };
  });
  check(
    'My PRs tab selected on its page',
    selected.mine.ariaCurrent === 'page' || selected.mine.selectedClass,
    JSON.stringify(selected.mine),
  );
  check(
    'original Pull requests tab deselected',
    selected.prs.ariaCurrent === null && selected.prs.selectedClass === false,
    JSON.stringify(selected.prs),
  );
  await shot(page, '02-my-prs-tab-selected.png');

  // ── Pick a multi-file PR (react/react PRs almost always touch __tests__) ──
  console.log('\n== Picking a PR ==');
  await page.goto('https://github.com/react/react/pulls?q=is%3Apr+is%3Amerged+sort%3Aupdated-desc', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('a[href*="/pull/"]');
  const prUrls = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/react/react/pull/"][id^="issue_"], a.js-navigation-open[href*="/pull/"]')]
      .map(link => link.getAttribute('href'))
      .filter(Boolean)
      .slice(0, 4),
  );
  check('found merged PRs', prUrls.length > 0, prUrls.join(', '));
  // Tiny PRs make jump/segment checks meaningless — pick one with enough files
  let prPath = null;
  let prFileCount = 0;
  for (const url of prUrls) {
    const path = url.startsWith('http') ? new URL(url).pathname : url;
    await page.goto(`https://github.com${path}/files`, {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('div.js-file', {timeout: 60_000}).catch(() => null);
    const count = await page.evaluate(() => document.querySelectorAll('div.js-file').length);
    console.log(`  candidate ${path}: ${count} files`);
    if (count >= 4) {
      prPath = path;
      prFileCount = count;
      break;
    }
  }
  check('found a PR with >= 4 files', Boolean(prPath), `${prPath} (${prFileCount} files)`);
  console.log(`  using PR: ${prPath}`);

  // ── 2. Impact bar, classic view (/files) ─────────────────────────────────
  console.log('\n== Impact bar, classic view ==');
  // Picker already left us on the chosen /files page
  await page.waitForSelector('#prix-bar', {timeout: 15_000});

  // Scroll to force lazy-mounted files, then back to top
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 800) {
      window.scrollTo(0, y);
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1000);

  const classic = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#prix-bar .prix-chip')].map(chip => ({
      category: chip.getAttribute('data-category'),
      state: chip.getAttribute('data-state'),
      meta: chip.querySelector('.prix-chip-meta')?.textContent?.trim(),
      hidden: chip.hidden,
    }));
    const files = [...document.querySelectorAll('div.js-file')];
    return {
      bars: document.querySelectorAll('#prix-bar').length,
      segments: document.querySelectorAll('#prix-bar .prix-bar-track .prix-segment').length,
      chips,
      totals: document.querySelector('#prix-bar .prix-totals')?.textContent?.trim(),
      controls: [...document.querySelectorAll('#prix-bar .prix-control')].map(b => b.getAttribute('aria-label')),
      fileCount: files.length,
      badges: document.querySelectorAll('.prix-badge').length,
      collapsed: files.filter(f => f.classList.contains('prix-collapsed')).length,
      hidden: files.filter(f => f.classList.contains('prix-hidden')).length,
    };
  });
  check('exactly one impact bar', classic.bars === 1, `bars=${classic.bars}`);
  check('slim bar has segments without inner text', classic.segments >= 2, `segments=${classic.segments}`);
  check('legend chips render', classic.chips.length >= 2, JSON.stringify(classic.chips));
  check('totals shown', /\d+ files? · \d+ lines/.test(classic.totals ?? ''), classic.totals);
  check(
    'control buttons present',
    ['Previous visible file (Shift+K)', 'Next visible file (Shift+J)', 'Expand all categories', 'Collapse all categories', 'Copy impact report as markdown'].every(
      label => classic.controls.includes(label),
    ),
    JSON.stringify(classic.controls),
  );
  check('files parsed', classic.fileCount > 0, `files=${classic.fileCount}`);
  check('badges in file headers', classic.badges > 0, `badges=${classic.badges}`);
  console.log(`  files=${classic.fileCount} collapsed=${classic.collapsed} hidden=${classic.hidden}`);
  await shot(page, '03-impact-bar-classic.png');

  // ── 3. File tree dimming ─────────────────────────────────────────────────
  console.log('\n== File tree sync ==');
  const tree = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('li.js-tree-node')].filter(row => row.querySelector('a[href^="#diff-"]'));
    const byState = state => rows.filter(row => row.classList.contains(state)).length;
    return {
      fileRows: rows.length,
      collapsed: byState('prix-tree-collapsed'),
      hidden: byState('prix-tree-hidden'),
    };
  });
  check('tree rows found', tree.fileRows > 0, `rows=${tree.fileRows}`);
  check('collapsed category dims tree rows', tree.collapsed > 0, JSON.stringify(tree));

  // ── 4. Chip interaction: cycle tests collapsed → hidden → visible → collapsed ──
  console.log('\n== Chip interaction ==');
  const target = await page.evaluate(
    () => document.querySelector('#prix-bar .prix-chip:not([hidden])')?.getAttribute('data-category') ?? null,
  );
  if (target) {
    const NEXT = {visible: 'collapsed', collapsed: 'hidden', hidden: 'visible'};
    const initial = await page.evaluate(
      category => document.querySelector(`#prix-bar .prix-chip[data-category="${category}"]`)?.getAttribute('data-state'),
      target,
    );
    const expected = [NEXT[initial], NEXT[NEXT[initial]], NEXT[NEXT[NEXT[initial]]]];
    const states = [];
    for (let i = 0; i < 3; i++) {
      await page.click(`#prix-bar .prix-chip[data-category="${target}"]`);
      await page.waitForTimeout(300);
      states.push(
        await page.evaluate(category => {
          const chip = document.querySelector(`#prix-bar .prix-chip[data-category="${category}"]`);
          const containers = [...document.querySelectorAll('div.js-file .prix-badge')]
            .filter(badge => badge.textContent === category)
            .map(badge => badge.closest('div.js-file'));
          return {
            chipState: chip?.getAttribute('data-state'),
            collapsed: containers.every(el => el?.classList.contains('prix-collapsed')),
            hidden: containers.every(el => el?.classList.contains('prix-hidden')),
            containerCount: containers.length,
          };
        }, target),
      );
    }

    check(
      `chip "${target}" cycles ${initial}→${expected.join('→')}`,
      states.every((state, i) => state.chipState === expected[i]),
      JSON.stringify(states.map(s => s.chipState)),
    );
    const matchesState = (state, expectedState) =>
      expectedState === 'collapsed' ? state.collapsed && !state.hidden
        : expectedState === 'hidden' ? state.hidden
        : !state.collapsed && !state.hidden;
    if (states[0]?.containerCount > 0) {
      check(
        'container classes follow chip state',
        states.every((state, i) => matchesState(state, expected[i])),
        JSON.stringify(states.map(s => ({s: s.chipState, c: s.collapsed, h: s.hidden}))),
      );
    }

    // Tree rows follow too (tests passed through hidden in the cycle)
    const treeAfterCycle = await page.evaluate(() => ({
      collapsedRows: document.querySelectorAll('li.js-tree-node.prix-tree-collapsed').length,
      hiddenRows: document.querySelectorAll('li.js-tree-node.prix-tree-hidden').length,
    }));
    check(
      'tree rows track category state after cycle',
      treeAfterCycle.collapsedRows > 0 && treeAfterCycle.hiddenRows === 0,
      JSON.stringify(treeAfterCycle),
    );
    await shot(page, '04-chip-cycled.png');
  } else {
    check('chip clickable', false, 'no chip found');
  }

  // ── 5. Jump (Shift+J / Shift+K + buttons) ────────────────────────────────
  console.log('\n== Jump ==');
  const flashIndex = () =>
    page.evaluate(() => {
      const containers = [...document.querySelectorAll('div.js-file')];
      return containers.findIndex(el => el.classList.contains('prix-flash'));
    });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  // Button first: Playwright scrolls the bar into view for the click, which
  // would disturb keyboard-based assertions if done later
  await page.click('#prix-bar .prix-control[aria-label^="Next visible"]');
  await page.waitForTimeout(500);
  const afterButton = await page.evaluate(() => window.scrollY);
  check('jump button works', afterButton > 0, `scrollY → ${afterButton}`);
  const firstFlash = await flashIndex();
  check('jump target flashes', firstFlash >= 0, `flash index=${firstFlash}`);
  await page.keyboard.press('Shift+J');
  await page.waitForTimeout(500);
  const secondFlash = await flashIndex();
  check('Shift+J jumps to next visible file', secondFlash > firstFlash, `flash ${firstFlash} → ${secondFlash}`);
  await page.keyboard.press('Shift+K');
  await page.waitForTimeout(500);
  const thirdFlash = await flashIndex();
  check('Shift+K jumps back', thirdFlash === firstFlash, `flash ${secondFlash} → ${thirdFlash}`);

  // ── 6. Expand-all / collapse-all ─────────────────────────────────────────
  console.log('\n== Expand/collapse all ==');
  await page.click('#prix-bar .prix-control[aria-label="Collapse all categories"]');
  await page.waitForTimeout(400);
  const allCollapsed = await page.evaluate(() => {
    const files = [...document.querySelectorAll('div.js-file')];
    return {collapsed: files.filter(f => f.classList.contains('prix-collapsed')).length, total: files.length};
  });
  check('collapse-all collapses every file', allCollapsed.collapsed === allCollapsed.total, JSON.stringify(allCollapsed));
  await shot(page, '05-collapse-all.png');
  await page.click('#prix-bar .prix-control[aria-label="Expand all categories"]');
  await page.waitForTimeout(400);
  const allExpanded = await page.evaluate(
    () => document.querySelectorAll('div.js-file.prix-collapsed, div.js-file.prix-hidden').length,
  );
  check('expand-all restores every file', allExpanded === 0, `still filtered=${allExpanded}`);

  // ── 7. Copy impact report ────────────────────────────────────────────────
  console.log('\n== Copy report ==');
  await page.click('#prix-bar .prix-control[aria-label="Copy impact report as markdown"]');
  await page.waitForTimeout(500);
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  check(
    'clipboard holds a markdown table',
    clipboard.includes('| Category | Files |') && /\| \w[\w/]* \| \d+ \|/.test(clipboard),
    clipboard.split('\n').slice(0, 3).join(' / '),
  );

  // ── 8. Soft nav: Commits tab → Files tab ─────────────────────────────────
  console.log('\n== Soft navigation ==');
  const commitsTab = await page.$(`a[href$="${prPath}/commits"]`);
  if (commitsTab) {
    await commitsTab.click();
    await page.waitForURL('**/commits'); // the /files link also exists pre-navigation — wait for the URL
    await page.click(`a[href$="${prPath}/files"]`);
    await page.waitForURL('**/files');
    await page.waitForSelector('div.js-file', {timeout: 60_000});
    await page.waitForSelector('#prix-bar', {timeout: 15_000});
    await page.waitForTimeout(500);
    const barCount = await page.evaluate(() => document.querySelectorAll('#prix-bar').length);
    check('impact bar re-appears once after soft nav', barCount === 1, `bars=${barCount}`);
    await shot(page, '06-after-soft-nav.png');
  } else {
    check('soft nav test', false, 'commits tab not found');
  }

  // ── 9. Language impact chart on a langwatch PR ───────────────────────────
  console.log('\n== Language impact chart ==');
  await page.goto('https://github.com/langwatch/langwatch/pull/5863/files', {waitUntil: 'domcontentloaded'});
  await page.waitForSelector('div.js-file', {timeout: 60_000});
  await page.waitForSelector('#prix-bar', {timeout: 15_000});
  const chartText = await page
    .waitForSelector('#prix-bar .prix-chart:not([hidden])', {timeout: 15_000})
    .then(() => page.evaluate(() => document.querySelector('#prix-bar .prix-chart')?.textContent?.trim()))
    .catch(() => null);
  check(
    'Language Impact Map shown for langwatch PR',
    chartText === 'Impact Map: Deps 43% · Python 29% · SDKs 29%',
    JSON.stringify(chartText),
  );
  await shot(page, '07-langwatch-chart.png');

  // ── 10. New React view (/changes) — expected to redirect when logged out ──
  console.log('\n== React view (/changes) ==');
  await page.goto(`https://github.com${prPath}/changes`, {waitUntil: 'domcontentloaded'});
  const onReactView = new URL(page.url()).pathname.endsWith('/changes');
  if (!onReactView) {
    console.log('  SKIP: /changes redirected to /files — the React PR files view is not reachable unauthenticated');
    await shot(page, '08-react-view-unavailable.png');
  } else {
    const reactContainers = await page.waitForSelector('div[id^="diff-"]', {timeout: 15_000}).catch(() => null);
    check('react view containers', Boolean(reactContainers));
  }
} finally {
  await context.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('Failures:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  process.exitCode = 1;
}
