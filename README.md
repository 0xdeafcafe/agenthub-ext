# PR Impact

A GitHub-only browser extension (Manifest V3, Chromium) that improves reviewing pull requests on the **Files changed** page.

When you open a PR's files page, PR Impact:

- Parses every file in the diff as it mounts (files mount lazily on scroll).
- Classifies each file into categories via glob rules — built-in: `tests`, `docs`, `generated` (incl. lockfiles); everything else is `code`. Repos can define their own categories (e.g. `server`, `sdk`).
- Renders an **impact bar** at the top of the files area: a slim stacked bar (one segment per category, sized by share of changed lines, tooltips carry the numbers) with a legend row of category chips showing `3 files · 35 lines · 22%`. Clicking a chip cycles that category's display state: **visible → collapsed → hidden → visible**. Collapsed keeps the file header and hides the diff body; hidden removes the whole file container (chips show state via opacity/strikethrough). State is persisted per category in `chrome.storage.local` and overrides the config defaults on later visits.
- Bar controls (right side of the legend): totals (`9 files · 185 lines · 2 reviewed`), jump to previous/next visible file (also `Shift+K` / `Shift+J`), expand-all, collapse-all, and **copy impact report** (markdown table on the clipboard).
- Adds a small dimmed category badge (e.g. `tests`) to each file header, and dims the matching rows in GitHub's file tree (collapsed: slightly, hidden: 35% opacity + badge).
- Folds in GitHub's viewed state: per-category `n of m reviewed` in chip tooltips and a reviewed total in the bar (logged-in only — the viewed toggle isn't rendered logged out).
- If the PR has a Language **PR Impact Map** bot comment (aggregate per-category percentages), its breakdown is shown under the bar and used for the copied report.

It also adds a **My PRs** tab to the repository nav (right after Pull requests), linking to open PRs by you (`author:@me`), with an accent-colored counter of your open PRs (count fetch needs a login; absent logged out).

## Dual-view support

GitHub runs two coexisting versions of the PR files page:

- **Classic view** at `/pull/:n/files` (`div.js-file` containers).
- **New React view** at `/pull/:n/changes` (`div[id^="diff-"]` containers, hashed CSS-module classes).

Both are supported via per-view DOM adapters (`lib/views.ts`). The feature triggers on both routes, including `/changes/<sha>..<sha>` ranges.

**Virtualization caveat:** on huge PRs the React view virtualizes the file list and removes off-screen DOM nodes. Filtering still works, but the impact bar's counts only reflect files that have mounted so far (they grow as you scroll). Classic-view oversized diffs behind "Load diff" buttons are counted as files but their lines may not be.

## Per-repo configuration

Add `.github/pr-impact.yml` to a repo to customize categories. It's fetched same-origin with the user's session cookies, so it works for private repos too. On any fetch/parse error the extension fails open to the built-in defaults.

```yaml
categories:
  tests:
    globs: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/test/**", "**/tests/**"]
    action: collapse        # visible | collapse | hide
  docs:
    globs: ["**/*.md", "**/*.mdx", "docs/**"]
    action: hide
  generated:
    globs: ["**/*.pb.go", "**/*.generated.*", "**/gen/**", "**/generated/**"]
    action: hide
  server:
    globs: ["server/**"]
    action: visible
```

- First matching rule wins; unmatched files fall into the implicit `code` category (always listed last in the bar).
- `action` is the default display state; unknown actions/keys are ignored.
- Built-in defaults (used when there's no config file): `tests` → collapse, `docs` → hide, `generated` → hide (including `**/package-lock.json`, `**/yarn.lock`, `**/pnpm-lock.yaml`, `**/go.sum`, `**/Cargo.lock`).

## Development

```sh
npm install        # also runs `wxt prepare` (types)
npm run build      # outputs .output/chrome-mv3/
npm test           # vitest: classifier, config parser, state-cycle unit tests
npm run dev        # watch mode with auto-reload
npm run test:e2e   # live smoke test against github.com (see below)
```

### Live e2e smoke test

`npm run test:e2e` runs `e2e/smoke.mjs`: a `playwright-core` script that loads the built extension into a persistent browser context and verifies the My PRs tab, impact bar, segment cycling, and soft-nav behavior against live github.com. Screenshots land in `e2e/screenshots/` (gitignored).

Browser notes: branded Chrome ≥ 137 ignores `--load-extension`, and Arc refuses Playwright's CDP launch, so the script uses the **Chrome for Testing** binary already present in the Playwright cache (`~/Library/Caches/ms-playwright/chromium-1228/...`). It runs with the new headless mode; nothing is downloaded.

Unauthenticated limitations: GitHub redirects `/pull/<n>/changes` to `/files` when logged out, so the new React files view is not covered by the e2e run; and `author:@me` redirects to `/pulls/@me`, so the tab's selected state is exercised via a spoofed URL + synthetic `turbo:render` instead of real navigation.

Stack: [WXT](https://wxt.dev) + TypeScript, [dom-chef](https://github.com/vadimdemedes/dom-chef) for TSX-to-DOM UI, [picomatch](https://github.com/micromatch/picomatch) for globs, [yaml](https://github.com/eemeli/yaml) for config parsing. No background service worker; one content script at `document_start`, CSS injected via the manifest (no FOUC).

## Loading in Arc

1. Run `npm run build`.
2. Open `arc://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select this project's `.output/chrome-mv3` directory.
5. After code changes: run `npm run build` again, then click the extension's **reload** button on `arc://extensions` and refresh the GitHub tab.
