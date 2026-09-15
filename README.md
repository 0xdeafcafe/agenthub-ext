# PR Impact

[![Build](https://github.com/0xdeafcafe/agenthub-ext/actions/workflows/build.yml/badge.svg)](https://github.com/0xdeafcafe/agenthub-ext/actions/workflows/build.yml)

Big PRs are a pain to review. Half the diff is tests, docs, generated code, and some enormous lockfile. This puts controls on the PR page so you can get to the stuff you actually need to read.

Collapse the noise. See where edits cluster. Stop counting comments as code. Your filters stick per repo.

## Install it

**Arc / Chrome / Edge / Brave:** [download the ZIP](https://github.com/0xdeafcafe/agenthub-ext/releases/download/rolling/pr-impact-chrome-mv3.zip).

1. Unzip it somewhere you’ll keep it.
2. Open `arc://extensions` or `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the folder containing `manifest.json`.
5. Refresh your GitHub tabs.

That’s it. For updates, replace the files in that folder, hit **Reload** on the extension, and refresh GitHub again.

The download tracks the last `main` commit that passed the checks. Every merge builds fresh ZIPs. Named versions live on the [releases page](https://github.com/0xdeafcafe/agenthub-ext/releases); main builds don’t take over the latest stable version.

Other browsers:

- **Firefox:** [download](https://github.com/0xdeafcafe/agenthub-ext/releases/download/rolling/pr-impact-firefox-mv2.zip), unzip, open `about:debugging` → **This Firefox** → **Load Temporary Add-on**, and select `manifest.json`. It’s unsigned, so you’ll need to load it again after restarting Firefox.
- **Safari:** [download the Xcode project](https://github.com/0xdeafcafe/agenthub-ext/releases/download/rolling/pr-impact-safari-xcode.zip). Open it in Xcode, pick your signing team, then build and enable it in Safari. This is source for an unsigned app, not an installer.

[Actions](https://github.com/0xdeafcafe/agenthub-ext/actions/workflows/build.yml) also keeps ZIPs for each PR and merge build. GitHub wraps an artifact download in another ZIP; unpack that first. Release downloads above skip the extra layer. Releases include `SHA256SUMS` if you want to verify a download.

## What you get

- **Review focus** on the PR conversation page and both versions of Files changed. Code, tests, specs, docs, and generated files get separate controls. Click a category to expand, collapse, or hide it. **Focus code** and **Show all** do what they say.
- **Change map** shows where the edits are. Bigger tile, more changed lines. Open folders, focus on one part of the repo, or jump straight to a file. It groups by path; it isn’t a dependency graph.
- **Exclude comment-only lines** adjusts the counts, percentages, map, and copied report. Inline code still counts.
- **Unreviewed only** skips files you’ve marked as viewed. GitHub has to load a file’s viewed control before we know its state.
- **Per-file controls** under **⋯** let you override a filter, see why a file got its category, or fix that category for the repo.
- **Saved views** keep your category choices, folder, comment counting, and review filter together. Up to 20 per repo.
- **Shift+J / Shift+K** jump between files. **Copy report** copies a Markdown breakdown. Settings has defaults, repo resets, and an off switch.
- **My PRs** and **Review requested** tabs sit next to GitHub’s Pull requests tab, with counts when you’re signed in.

If the PR has a Language **PR Impact Map** comment, its summary shows up too. Comment exclusion uses our diff counts instead.

## The annoying GitHub bits

The extension downloads the PR diff so counts don’t grow every time you scroll. Commit ranges work too. If the diff is unavailable, incomplete, bigger than 20 MB, or uses an unsupported comparison such as **Hide whitespace**, the panel says the counts only cover loaded files. Cached totals are reused only when both the head and base revisions match.

In GitHub’s `?mode=virtualization` view, filtered files keep a compact header. GitHub owns the row heights; fighting its scroll calculations causes flicker and jumping. We use its native collapse controls and track files by path as GitHub recycles the DOM.

Comment detection is conservative. It recognizes common comment syntax and keeps inline code, strings, and shebangs. A diff isn’t a whole source file, so a comment that starts outside the patch can still count. Unknown syntax stays counted.

GitHub configuration and diffs are fetched using your session. Public diffs can redirect to GitHub’s patch host, which the background worker handles. Diff contents aren’t sent to another service or saved to storage.

## Repo config

Drop `.github/pr-impact.yml` into a repo if the defaults don’t fit:

```yaml
categories:
  tests:
    globs: ['**/*.test.*', '**/*.spec.*', '**/*_test.*', '**/tests/**']
    action: collapse
  specs:
    globs: ['**/*.feature']
    action: collapse
  docs:
    globs: ['**/*.md', '**/*.mdx', 'docs/**']
    action: hide
  generated:
    globs: ['**/*.generated.*', '**/generated/**', '**/package-lock.json']
    action: hide
  server:
    globs: ['server/**']
    action: visible
```

First matching rule wins. Everything else is `code`. Actions are `visible`, `collapse`, or `hide`. Bad config falls back to the defaults; private repos work too.

Optional `defaultView: [code, server]` starts just those categories expanded and hides the rest. Virtualized pages still keep the compact headers. Your saved choices override these defaults.

## Work on it locally

```sh
npm ci
npm run dev:preview
```

Open [localhost:4173](http://127.0.0.1:4173). It runs the real content script against local GitHub fixtures and reloads when you edit. No account or extension install needed.

Useful pages:

- [PR overview](http://127.0.0.1:4173/acme/review-kit/pull/42)
- [Virtualized changes](http://127.0.0.1:4173/acme/review-kit/pull/42/changes?mode=virtualization)
- [Settings](http://127.0.0.1:4173/popup.html)
- [Screenshots](http://127.0.0.1:4173/screenshots/)
- [Visual comparisons](http://127.0.0.1:4173/visual/)

The toolbar switches themes and GitHub layouts, adds 250 files, remounts files, and replaces headers. Add `?scenario=partial` to exercise a failed inventory download. `PRIX_PORT` changes the port.

### Keep it working

```sh
npm run check                  # Oxlint, Oxfmt, TypeScript, unit/DOM/release tests
npm run lint:fix               # automatic lint fixes
npm run fmt                    # format everything
npm run test:browser:install    # install Chromium once
npm run screenshots            # browser checks + screenshots
npm run test:visual             # compare against checked-in screenshots
npm run test:extension          # build and test the actual extension
```

CI runs the checks on Linux and macOS, including both sets of screenshot baselines. Screenshots are uploaded even when a test fails. `PRIX_BROWSER` picks a different Chromium executable; production-extension tests need a browser that allows loading unpacked extensions.

For a deliberate visual change, inspect the screenshots, then run `npm run test:visual:update` on the matching OS and commit the changed baselines. Don’t update them just to make a red check green.

`npm run test:e2e` runs the optional live GitHub smoke tests after a build. Logged-out GitHub redirects some React pages, so the local fixtures cover those cases. Fixtures won’t tell us when GitHub changes its DOM again.

### Load your build in Arc

```sh
npm run build                  # .output/chrome-mv3/
npm run package                # dist/pr-impact-chrome-mv3.zip
npm run package -- firefox     # dist/pr-impact-firefox-mv2.zip
```

Load `.output/chrome-mv3` from `arc://extensions` with Developer mode on. After changes, rebuild, reload the extension, and refresh the GitHub tab. `npm run dev` is WXT’s extension watch mode.

## Cut a release

Merging to `main` is enough for a fresh downloadable build. For a named version:

```sh
git switch main
git pull --ff-only
npm run release -- 0.2.0
```

That tags the current commit as `v0.2.0` and pushes the tag. The command refuses a dirty checkout, an existing tag, or a local `main` that differs from the remote. Add `--dry-run` to check without changing anything.

GitHub Actions runs the checks, builds all three browser downloads, adds checksums, and publishes a release with generated notes. The tag supplies the version inside the extension; `package.json` supplies the version for ordinary dev and main builds. Use three numbers, like `0.2.0`.

Only the publish job has repository write access. Tests and packaging use read-only tokens. Rolling downloads are updated in place, stay marked as prereleases, and point to the exact tested commit.

## If it breaks

Turn it off in Settings. If you can’t get there, run this in the GitHub page’s console and reload:

```js
localStorage.setItem('prix-disabled', '1');
```

Remove that key and reload to bring it back. Logs start with `[PR Impact]`; include those and any React errors in a bug report.

Built with WXT, TypeScript, dom-chef, picomatch, and YAML. Playwright handles the browser tests. No UI framework shipped to GitHub.
