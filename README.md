# PR Impact

[![Build](https://github.com/0xdeafcafe/agenthub-ext/actions/workflows/build.yml/badge.svg)](https://github.com/0xdeafcafe/agenthub-ext/actions/workflows/build.yml)

Reviewing a PR on GitHub means finding the five lines that matter buried under 2,000 that don't - generated code, lockfiles, snapshot churn. PR Impact is a browser extension (Manifest V3, Chromium) that sorts the **Files changed** page into categories and collapses the noise down to the code you actually have to read.

## Downloads

These links always point at the current build - they track a rolling release called `rolling`, deleted and recreated on every push to `main`, so you're never waiting on a version tag. (When a real version tag does get cut, its release takes over the `latest` slot until the next main push. Both link shapes keep working throughout.) The repo is **private**, so the links only work when you're logged into GitHub with access - yes, even the zips, GitHub auth-walls those too.

- **Chrome / Edge / Brave** - [pr-impact-chrome-mv3.zip](https://github.com/0xdeafcafe/agenthub-ext/releases/latest/download/pr-impact-chrome-mv3.zip): unzip, then `chrome://extensions` → Developer mode → Load unpacked → select the unzipped folder.
- **Arc** - the _same_ [pr-impact-chrome-mv3.zip](https://github.com/0xdeafcafe/agenthub-ext/releases/latest/download/pr-impact-chrome-mv3.zip), at `arc://extensions`. Same steps.
- **Firefox** - [pr-impact-firefox-mv2.zip](https://github.com/0xdeafcafe/agenthub-ext/releases/latest/download/pr-impact-firefox-mv2.zip): `about:debugging` → This Firefox → Load Temporary Add-on → select the zip's `manifest.json`. Unsigned, so it's a _temporary_ add-on (gone after a browser restart) until someone publishes it to AMO.
- **Safari** - [pr-impact-safari-xcode.zip](https://github.com/0xdeafcafe/agenthub-ext/releases/latest/download/pr-impact-safari-xcode.zip): an **unsigned** Xcode project, straight out of `safari-web-extension-converter`. Open it in Xcode, set your Apple ID under Signing & Capabilities, build it yourself. No, there's no easier way. Apple made sure of that.

Every push to `main` also publishes these as workflow artefacts on the [Actions page](https://github.com/0xdeafcafe/agenthub-ext/actions/workflows/build.yml) (`pr-impact-chrome-arc`, `pr-impact-firefox`, `pr-impact-safari-xcode-project`).

## What it does

Open a PR's overview or files page and PR Impact:

- Downloads the current PR or commit-range diff to inventory files before you scroll, including renames and binary files. A coverage label distinguishes a complete inventory from counts based on loaded files. DOM observers apply controls as GitHub mounts each file.
- Classifies each file by glob rules. Built in: `tests` (Go-style `foo_test.go` included), `specs` (`.feature` files), `docs`, `generated` (lockfiles included). Everything else is `code`. Repos can define their own categories (`server`, `sdk`, whatever) via a config file - see below.
- Renders a responsive **Review focus** panel with a stacked impact bar, category percentages, and explicit Expanded / Collapsed / Hidden labels. Clicking a category cycles through those states. **Focus code** expands code and collapses the other categories; **Show all** restores every diff. Category choices persist per repository in `chrome.storage.local` and override defaults on your next visit. Colors follow GitHub’s light/dark theme, controls work with a keyboard, and motion respects reduced-motion preferences.
- The panel shows totals, review progress, and how many files and lines remain expanded. Jump between files with the arrow buttons or `Shift+K` / `Shift+J`. **Copy report** puts a markdown table on your clipboard and confirms success or explains a clipboard failure.
- Adds a dimmed category badge (`tests` and friends) to each file header, and dims the matching rows in GitHub's file tree - 35% opacity plus the badge for hidden files, a lighter touch for collapsed ones. A folder whose contents are entirely faded gets faded itself, and its disclosure closed once (re-open it by hand and it stays open - your call beats ours).
- Counts GitHub's viewed state: `n of m reviewed` per category in the chip tooltips, and a reviewed total in the bar. Logged in only, since GitHub doesn't render the viewed toggle logged out.
- **Unreviewed only** hides files GitHub has marked as viewed; navigation skips them. Native reviewed state becomes known when GitHub mounts a file.
- Each file's **⋯** menu explains the matching classification rule, lets you correct its category for this repository, and overrides that file's visibility for the current visit. **Show all** and **Focus code** clear visibility overrides.
- **Exclude comment-only lines** removes recognized comment-only additions and deletions from totals, category percentages, the map, and copied reports. Inline code still counts. The preference is remembered per repository and can also be the global default.
- The interactive **Change map** groups changes by directory. Tile area follows changed lines, color follows category, and faded tiles show collapsed/hidden work. Drill into folders, focus the diff on a folder, or open a file directly. A text list makes small tiles accessible. This shows where edits cluster by path; it does not infer dependencies between files.
- **Saved views** remember category states, folder focus, unreviewed mode, and comment counting for a repository. Save up to 20 named presets, restore them, or delete them from the panel.
- The extension **Settings** popup has a live enable switch, default category states, default unreviewed/comment preferences, and reset controls for the active repository.
- If the PR has a Language **PR Impact Map** bot comment (their per-category percentages), the breakdown shows under the bar and the copied report uses their numbers. Comment exclusion uses locally analyzed counts instead.

There's also a pair of extra tabs in the repo nav, right after Pull requests: **My PRs** (your open PRs in this repo, `author:<you>`) and **Review requested** (open PRs waiting on your review). Both get a live count - accent-filled for My PRs so it reads as yours at a glance, GitHub's default grey for Review requested so the two don't compete. The counts need you logged in; logged out they stay politely empty.

## The kill switch

Use the extension popup’s **Enable PR Impact** switch to turn controls off immediately. The console-based emergency switch also remains available:

1. Open any `github.com` page.
2. DevTools → Console → `localStorage.setItem('prix-disabled', '1')`
3. Reload. PR Impact now does nothing, on every GitHub page, and logs `[PR Impact] disabled via localStorage "prix-disabled"` to prove it.

`localStorage.removeItem('prix-disabled')` and a reload brings it back.

Everything the extension logs carries an `[PR Impact]` prefix. If you're reporting a breakage, grab those lines plus any React `removeChild`/`insertBefore` errors - those two together usually tell the whole story.

## Two GitHubs, one extension

GitHub runs two versions of the PR files page at once:

- **Classic view** at `/pull/:n/files` (`div.js-file` containers).
- **New React view** at `/pull/:n/changes` (`div[id^="diff-"]` containers, hashed CSS-module classes).

Both work, via per-view DOM adapters (`lib/views.ts`), including `/changes/<sha>..<sha>` range URLs.

**PR overview:** the panel also appears below the PR navigation on `/pull/:number`, with full inventory, category controls, comment exclusion, presets, and the change map. Opening a map file takes you to its GitHub diff anchor and reveals it even when its category is filtered.

**Virtualized changes (`?mode=virtualization`):** filtering uses GitHub’s native file disclosures so GitHub updates its own row heights. Filtered files retain a compact header in this mode. PR Impact does not hide measured slots or override spacer heights. Recycled containers and headers are reclassified by their current path; same-URL React updates preserve filters, overrides, and the open map. User clicks on native disclosures take precedence over category defaults.

**Inventory and virtualization:** the full diff supplies counts for files GitHub has not mounted yet. Files are tracked by path, so remounting never double-counts them. If the download fails, has incomplete hunks, exceeds 20 MB, or the URL uses an unsupported comparison scope, the panel labels its partial coverage and keeps filtering loaded files. Cached aggregate counts are isolated by revision, comparison, rules, and classification corrections; unverified revisions expire after 15 minutes. GitHub’s reviewed state is only known for files whose native controls have mounted.

**Comment counting:** a stateful scanner recognizes common C-style, hash, SQL, and HTML/XML comments by filename. Added and removed sides are scanned independently. It retains inline code, strings, blank lines, and shebangs. Unknown languages and ambiguous syntax remain counted. Patch hunks do not contain the whole file, so comments that start outside the supplied context can remain counted. This is a conservative estimate, not a full language parser. If the inventory is unavailable, the panel explains that comment analysis is unavailable.

The extension uses GitHub session access to fetch repository configuration and diffs. A small background worker handles GitHub’s redirect to `patch-diff.githubusercontent.com`; requests are restricted to the sending tab’s PR or commit range. It does not send diffs to another service or persist their source text.

## Per-repo configuration

Drop `.github/pr-impact.yml` in a repo to customise the categories. It's fetched same-origin with your session cookies, so private repos work. Any fetch or parse error falls back to the built-in defaults - a bad config file will never break the page.

```yaml
defaultView: [code] # categories that start expanded; everything else starts hidden
categories:
  tests:
    globs:
      ['**/*.test.*', '**/*.spec.*', '**/*_test.*', '**/__tests__/**', '**/test/**', '**/tests/**']
    action: collapse # visible | collapse | hide
  specs:
    globs: ['**/*.feature']
    action: collapse
  docs:
    globs: ['**/*.md', '**/*.mdx', 'docs/**']
    action: hide
  generated:
    globs: ['**/*.pb.go', '**/*.generated.*', '**/gen/**', '**/generated/**']
    action: hide
  server:
    globs: ['server/**']
    action: visible
```

- `defaultView` is optional. When set, listed categories start expanded and every other category starts hidden (as in, gone, zero scroll space). When it's absent, each category's `action` sets its starting state - and the built-in defaults already amount to code-only reading: `tests` → collapse (Go-style `foo_test.go` included), `specs` → collapse (`**/*.feature`), `docs` → hide, `generated` → hide (that last one includes `**/package-lock.json`, `**/yarn.lock`, `**/pnpm-lock.yaml`, `**/go.sum` and `**/Cargo.lock`).
- First matching rule wins. Unmatched files land in the implicit `code` category, always listed last in the bar.
- Unknown actions and keys are ignored.

## Development

```sh
npm ci
npm run dev:preview     # local playground at http://127.0.0.1:4173
```

The playground runs the **real content script and CSS** against local GitHub-shaped fixtures. Only browser storage is replaced with a localStorage-backed adapter. Source changes rebuild and reload automatically, with source maps for debugging. No GitHub account or extension installation is needed.

Use its toolbar to switch light/dark themes and classic/React views, mount another file, add 250 files, remount a virtualized file, replace a header, or reset saved preferences. Resizing the browser exercises the responsive layout. Open `/popup.html` to test settings, open `/acme/review-kit/pull/42` for the overview or `/acme/review-kit/pull/42/changes?mode=virtualization` for recycled scrolling rows; or add `?scenario=virtualized` / `?scenario=partial` to a PR fixture URL to exercise unloaded files and failed inventory downloads. All fixture network requests stay local. Set `PRIX_PORT` to change the port.

### Code quality

```sh
npm run check          # lint + formatting + TypeScript + unit tests
npm run lint           # Oxlint, including type-aware async checks
npm run lint:fix       # safe automatic lint fixes
npm run fmt            # format source, CSS, HTML, JSON, Markdown, and YAML with Oxfmt
npm run fmt:check      # check formatting without editing files
```

[Oxlint](https://oxc.rs/docs/guide/usage/linter/config) is configured in `.oxlintrc.json`: correctness rules, import cycles, strict equality, unused code, typed promises, and Vitest/accessibility checks. All diagnostics fail the command. Native ARIA groups/status elements are allowed where changing HTML tags would alter the controls’ layout. TypeScript still runs separately. [Oxfmt](https://oxc.rs/docs/guide/usage/formatter/config) uses `.oxfmtrc.json` for consistent formatting. Generated bundles, dependencies, screenshots, visual baselines, and the generated lockfile are excluded where appropriate. CI runs `npm run check` before browser tests and builds.

### Browser tests and screenshots

Install Chromium once, then run:

```sh
npm run test:browser:install
npm run test:local       # core browser checks + screenshots
npm run test:features    # map, comments, overrides, presets, settings, inventory
npm run test:pages       # PR overview and a scrolling virtualizer that reuses DOM nodes
npm run screenshots     # all three browser suites and their screenshots
npm run test:visual     # compare 12 screenshots against checked-in baselines
npm run test:extension  # build and test the actual unpacked MV3 extension
```

Screenshots and a standalone gallery are written to **`e2e/screenshots/local/index.html`**. While the playground is running, open **http://127.0.0.1:4173/screenshots/** to browse them. The matrix covers classic and React layouts in light/dark themes at 1440px and 390px, plus close-ups of the panel. A failed browser run saves `failure.png` for inspection. The feature suite adds map and settings screenshots.

**Visual regression:** `npm run test:visual` compares the panel, drilled map, file menu, and settings popup in light/dark themes, with desktop/mobile panel coverage. It uses a bundled font, managed Chromium, reduced motion, and fixed viewports. Missing baselines, changed dimensions, or pixel changes above the configured tolerance fail the check. Open **http://127.0.0.1:4173/visual/** or `e2e/screenshots/visual/index.html` for expected/actual/difference images. Baselines live in `e2e/baselines/darwin/` and `e2e/baselines/linux/`, so native control rendering is checked on its own platform. Both sets use the Chromium version installed by the lockfile.

After an intentional UI change, inspect the screenshots, run `npm run test:visual:update`, and review the baseline diff before committing it. CI never updates baselines automatically. `node e2e/visual.mjs --inject-regression` deliberately shifts the panel and should fail, allowing you to verify that the visual gate catches layout regressions.

The browser harness covers category cycling, focus/show-all presets, review progress, clipboard success and failure, header replacement, virtualization, repeated soft navigation, keyboard shortcuts, lazy mounting, and a 250-file stress case. The extension test uses a temporary browser profile and the **production build**, with GitHub requests intercepted and served from the local fixtures. It verifies real extension storage, persistence across reloads, both DOM adapters, and the kill switch without contacting GitHub.

The browser is discovered through Playwright’s managed installation. `PRIX_BROWSER=/path/to/chromium` overrides it. The local playground tests also accept installed Chrome; extension tests need Chromium/Chrome for Testing because branded Chrome disables command-line extension loading. On Linux CI, install system dependencies with `npm run test:browser:install -- --with-deps`.

```sh
npm test               # unit and DOM regression tests
npm run compile        # TypeScript checks, including playground code
npm run build          # production extension in .output/chrome-mv3/
npm run dev            # WXT extension watch mode
npm run test:e2e        # optional live GitHub smoke test; build first
```

CI runs lint, formatting, TypeScript, unit, local browser, visual regression, and production extension tests on pushes and pull requests, and uploads screenshots even if a test fails. The optional live test needs internet access and uses public GitHub PRs; logged-out GitHub can redirect React `/changes` pages, so the deterministic local fixtures cover that view. Fixtures cannot guarantee compatibility with future GitHub DOM changes; keep the live smoke test for that check.

Stack: [WXT](https://wxt.dev) + TypeScript, [dom-chef](https://github.com/vadimdemedes/dom-chef) for TSX-to-DOM UI, [picomatch](https://github.com/micromatch/picomatch) for globs, [yaml](https://github.com/eemeli/yaml) for configuration, esbuild for the local playground, and Playwright for browser tests. No UI framework is shipped; the background worker handles scoped diff downloads and opens the extension settings page.

## Loading a dev build in Arc

1. Run `npm run build`.
2. Open `arc://extensions`.
3. Enable **Developer mode** (top right).
4. **Load unpacked** → select this project's `.output/chrome-mv3` directory.
5. After changes: `npm run build` again, hit the extension's **reload** button on `arc://extensions`, refresh the GitHub tab.
