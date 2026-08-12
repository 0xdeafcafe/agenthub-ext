# PR Impact

[![Build](https://github.com/0xdeafcafe/agenthub-ext/actions/workflows/build.yml/badge.svg)](https://github.com/0xdeafcafe/agenthub-ext/actions/workflows/build.yml)

Reviewing a PR on GitHub means finding the five lines that matter buried under 2,000 that don't - generated code, lockfiles, snapshot churn. PR Impact is a browser extension (Manifest V3, Chromium) that sorts the **Files changed** page into categories and collapses the noise down to the code you actually have to read.

## Downloads

These links always point at the current build - they track a rolling release called `rolling`, deleted and recreated on every push to `main`, so you're never waiting on a version tag. (When a real version tag does get cut, its release takes over the `latest` slot until the next main push. Both link shapes keep working throughout.) The repo is **private**, so the links only work when you're logged into GitHub with access - yes, even the zips, GitHub auth-walls those too.

- **Chrome / Edge / Brave** - [pr-impact-chrome-mv3.zip](https://github.com/0xdeafcafe/agenthub-ext/releases/latest/download/pr-impact-chrome-mv3.zip): unzip, then `chrome://extensions` → Developer mode → Load unpacked → select the unzipped folder.
- **Arc** - the *same* [pr-impact-chrome-mv3.zip](https://github.com/0xdeafcafe/agenthub-ext/releases/latest/download/pr-impact-chrome-mv3.zip), at `arc://extensions`. Same steps.
- **Firefox** - [pr-impact-firefox-mv2.zip](https://github.com/0xdeafcafe/agenthub-ext/releases/latest/download/pr-impact-firefox-mv2.zip): `about:debugging` → This Firefox → Load Temporary Add-on → select the zip's `manifest.json`. Unsigned, so it's a *temporary* add-on (gone after a browser restart) until someone publishes it to AMO.
- **Safari** - [pr-impact-safari-xcode.zip](https://github.com/0xdeafcafe/agenthub-ext/releases/latest/download/pr-impact-safari-xcode.zip): an **unsigned** Xcode project, straight out of `safari-web-extension-converter`. Open it in Xcode, set your Apple ID under Signing & Capabilities, build it yourself. No, there's no easier way. Apple made sure of that.

Every push to `main` also publishes these as workflow artefacts on the [Actions page](https://github.com/0xdeafcafe/agenthub-ext/actions/workflows/build.yml) (`pr-impact-chrome-arc`, `pr-impact-firefox`, `pr-impact-safari-xcode-project`).

## What it does

Open a PR's files page and PR Impact:

- Parses every file in the diff as it mounts. Files mount lazily on scroll, so this runs off a MutationObserver, not a one-shot query (learned that the fun way).
- Classifies each file by glob rules. Built in: `tests`, `docs`, `generated` (lockfiles included). Everything else is `code`. Repos can define their own categories (`server`, `sdk`, whatever) via a config file - see below.
- Renders an **impact bar** at the top: a slim stacked bar with one segment per category, sized by share of changed lines, and a legend of chips (`tests`, `22%`) with the file and line counts in the tooltip. Clicking a chip cycles that category through **visible → collapsed → hidden → visible**. Collapsed keeps the file header, bins the diff body. Hidden bins the whole file. State persists per category in `chrome.storage.local` and beats the config defaults on your next visit.
- Bar controls on the right: totals (`9 files · 185 lines · 2 reviewed`), jump to previous/next visible file (or `Shift+K` / `Shift+J`), expand-all, collapse-all, and a **copy impact report** button that drops a markdown table on your clipboard.
- Adds a dimmed category badge (`tests` and friends) to each file header, and dims the matching rows in GitHub's file tree - 35% opacity plus the badge for hidden files, a lighter touch for collapsed ones.
- Counts GitHub's viewed state: `n of m reviewed` per category in the chip tooltips, and a reviewed total in the bar. Logged in only, since GitHub doesn't render the viewed toggle logged out.
- If the PR has a Language **PR Impact Map** bot comment (their per-category percentages), the breakdown shows under the bar and the copied report uses their numbers instead of ours.

There's also a pair of extra tabs in the repo nav, right after Pull requests: **My PRs** (your open PRs in this repo, `author:<you>`) and **Review requested** (open PRs waiting on your review). Both get a live count - accent-filled for My PRs so it reads as yours at a glance, GitHub's default grey for Review requested so the two don't compete. The counts need you logged in; logged out they stay politely empty.

## The kill switch

If the extension ever misbehaves (GitHub rearranged their DOM again, a selector over-matched), you can switch it off without uninstalling:

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

**The virtualization caveat:** on huge PRs the React view removes off-screen DOM nodes. Filtering still works, but the bar's counts only cover files that have mounted so far - the numbers grow as you scroll. Classic-view oversized diffs sat behind "Load diff" buttons count as files but might not count their lines.

## Per-repo configuration

Drop `.github/pr-impact.yml` in a repo to customise the categories. It's fetched same-origin with your session cookies, so private repos work. Any fetch or parse error falls back to the built-in defaults - a bad config file will never break the page.

```yaml
defaultView: [code]         # categories that start expanded; everything else starts hidden
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

- `defaultView` is optional. When set, listed categories start expanded and every other category starts hidden (as in, gone, zero scroll space). When it's absent, each category's `action` sets its starting state - and the built-in defaults already amount to code-only reading: `tests` → collapse, `docs` → hide, `generated` → hide (that last one includes `**/package-lock.json`, `**/yarn.lock`, `**/pnpm-lock.yaml`, `**/go.sum` and `**/Cargo.lock`).
- First matching rule wins. Unmatched files land in the implicit `code` category, always listed last in the bar.
- Unknown actions and keys are ignored.

## Development

```sh
npm install        # also runs `wxt prepare` (types)
npm run build      # outputs .output/chrome-mv3/
npm test           # vitest: classifier, config parser, state-cycle unit tests
npm run dev        # watch mode with auto-reload
npm run test:e2e   # live smoke test against github.com (see below)
```

### The e2e smoke test

`npm run test:e2e` runs `e2e/smoke.mjs`: a `playwright-core` script that loads the built extension into a persistent browser context and checks the My PRs tab, impact bar, chip cycling and soft-nav behaviour against live github.com. Screenshots land in `e2e/screenshots/` (gitignored).

Browser notes, earned the hard way: branded Chrome ≥ 137 ignores `--load-extension`, and Arc flatly refuses Playwright's CDP launch. The script therefore uses the **Chrome for Testing** binary already sitting in the Playwright cache (`~/Library/Caches/ms-playwright/chromium-1228/...`) in new headless mode. Nothing gets downloaded.

Logged-out limitations: GitHub redirects `/pull/<n>/changes` to `/files` when you're not logged in, so the React files view isn't covered by the e2e run. And `author:@me` redirects to `/pulls/@me`, so the tab's selected state gets exercised via a spoofed URL and a synthetic `turbo:render` instead of a real navigation.

Stack: [WXT](https://wxt.dev) + TypeScript, [dom-chef](https://github.com/vadimdemedes/dom-chef) for TSX-to-DOM UI, [picomatch](https://github.com/micromatch/picomatch) for globs, [yaml](https://github.com/eemeli/yaml) for config parsing. No background service worker - one content script at `document_start`, CSS injected via the manifest so there's no flash of unstyled page.

## Loading a dev build in Arc

1. Run `npm run build`.
2. Open `arc://extensions`.
3. Enable **Developer mode** (top right).
4. **Load unpacked** → select this project's `.output/chrome-mv3` directory.
5. After changes: `npm run build` again, hit the extension's **reload** button on `arc://extensions`, refresh the GitHub tab.
