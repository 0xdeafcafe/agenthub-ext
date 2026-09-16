import './content.css';
import {defineContentScript} from 'wxt/utils/define-content-script';
import {classify, explainClassification, compileRules, type CompiledRule} from '../lib/classifier';
import {fetchConfig} from '../lib/config';
import {
  findBarPlacement,
  ImpactBar,
  PR_HEADER_PROBE,
  spanningBarPlacement,
  type CategoryCount,
} from '../lib/impact-bar';
import {buildMarkdownReport, fetchImpactMap, type ImpactMap} from '../lib/impact-report';
import {injectBadge} from '../lib/badges';
import {FileIndex, adjustedLines} from '../lib/file-index';
import {browser} from 'wxt/browser';
import {ReviewPreferences, loadSettings, parseSettings, SETTINGS_KEY} from '../lib/preferences';
import {diffPathForPage} from '../lib/diff';
import {fetchInventory} from '../lib/inventory';
import {ReviewTools} from '../lib/review-tools';
import {initOverview} from '../lib/overview';
import {injectFileControls} from '../lib/file-controls';
import {
  aggregateFolderState,
  applyFolderState,
  applyTreeRowState,
  folderFileStates,
  folderKey,
  folderStatesByPath,
  isFolderRow,
  maybeAutoCollapseFolder,
  TREE_ROW_SELECTOR,
  treeRowContainerId,
  treeRowPath,
} from '../lib/file-tree';
import {ensureMyPrsTab, preloadMyPrCounts, watchMyPrsTab} from '../lib/my-prs-tab';
import {
  displayCounts,
  extractHeadSha,
  extractBaseSha,
  isCacheFresh,
  prCacheKey,
  readPrCounts,
  writePrCounts,
} from '../lib/pr-cache';
import {observeSelector} from '../lib/observer';
import {observeFiles} from '../lib/file-observer';
import {PR_PAGE_RE, PR_NAV_SELECTOR, pullHeaderPlacement, fileAnchor} from '../lib/pr-page';
import {VirtualFiles, isVirtualFile, nativeFileToggle, isFileExpanded} from '../lib/virtual-files';
import {guarded, logError, rafThrottled} from '../lib/safe';
import {defaultStateFor, CategoryStateStore, type DisplayState} from '../lib/state';
import {adapterFor, containerSelector, isFileContainer, outerFileWrapper} from '../lib/views';

/**
 * The files toolbar, found as defensively as we can: the module-class
 * section, then anything with the toolbar class fragment, then by content
 * (the "N / M viewed" counter lives in it, as does Submit review).
 */
function findFilesToolbar(): Element | null {
  const byClass =
    document.querySelector(
      'section[class*="PullRequestFilesToolbar-module__toolbar"], .pr-toolbar',
    ) ?? document.querySelector('[class*="PullRequestFilesToolbar"]');
  if (byClass) {
    return byClass;
  }

  for (const element of document.querySelectorAll('span, div, button')) {
    if (element.children.length > 0) {
      continue;
    }

    if (
      /\d[\d,]*\s*\/\s*\d[\d,]*\s*viewed/.test(element.textContent ?? '') ||
      element.textContent?.trim() === 'Submit review'
    ) {
      return element.closest('section, [class*="oolbar"]') ?? element.parentElement;
    }
  }

  return null;
}

/**
 * Anchor for the impact bar: after the files toolbar, else before the first
 * file container - into a block-flow parent inside the files region
 * (findBarPlacement), or as a full-span child of the nearest grid/wrapping
 * flex ancestor (spanningBarPlacement). The bar can never become a column in
 * GitHub's flex/grid row layout or jump above the PR header; when neither
 * placement is safe we skip the bar entirely - and warn, not error, because
 * a page shape we don't recognise is expected territory, not a crash (Arc
 * puts content-script console.error on the extension's Errors page).
 */
let barPlacementWarned = false;
let pathExtractionWarned = false;

/**
 * Human-readable rendering of the anchor's ancestor chain, for the placement
 * failure warning - tag, id, a snippet of class, computed display/flex-wrap,
 * and whether the PR-header probe matches at that level. This is the data
 * placement decisions are made from, so a failing page can be diagnosed from
 * the console line alone.
 */
function describeAnchorChain(anchor: Element): string {
  const parts: string[] = [];
  let el: Element | null = anchor;
  for (let hops = 0; el && hops < 9 && el !== document.body; hops++) {
    const {display, flexWrap} = getComputedStyle(el);
    const id = el.id ? `#${el.id}` : '';
    const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).slice(0, 2).join('.');
    const probe = hops > 0 && el.querySelector(PR_HEADER_PROBE) ? ' [HEADER-PROBE]' : '';
    parts.push(
      `${el.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''} ${display}/${flexWrap}${probe}`,
    );
    el = el.parentElement;
  }

  return parts.join(' <- ');
}

/** First 200 chars of an element's markup - enough to spot GitHub DOM changes. */
function markupSnippet(el: Element): string {
  return el.outerHTML.slice(0, 200);
}

function insertBar(bar: ImpactBar): void {
  if (document.getElementById('prix-bar')) {
    return;
  }

  if (new URLSearchParams(location.search).get('mode') === 'virtualization') {
    const placement = pullHeaderPlacement();
    if (placement) {
      bar.element.classList.add('prix-header-panel');
      placement.parent.insertBefore(bar.element, placement.before);
      return;
    }
  }

  const toolbar = findFilesToolbar();
  // Do not fall back to a file slot while GitHub is still mounting its header.
  if (new URLSearchParams(location.search).get('mode') === 'virtualization' && !toolbar) return;
  const anchor = toolbar?.nextElementSibling ?? document.querySelector(containerSelector);
  const placement = anchor
    ? (findBarPlacement(anchor) ?? spanningBarPlacement(anchor, bar.element))
    : toolbar?.parentElement
      ? {parent: toolbar.parentElement, before: null}
      : null;
  if (!placement) {
    if (!barPlacementWarned) {
      barPlacementWarned = true;
      console.warn(
        '[PR Impact]',
        'bar placement: nowhere safe to mount the bar on this page - skipping.',
        anchor
          ? `anchor chain: ${describeAnchorChain(anchor)}`
          : 'no anchor found (no toolbar, no file container)',
      );
    }

    return;
  }

  placement.parent.insertBefore(bar.element, placement.before);
}

const outerWrappers = new WeakMap<Element, Element>();
function applyState(container: Element, state: DisplayState, virtualFiles: VirtualFiles): void {
  if (!isFileContainer(container)) return;
  const virtual = isVirtualFile(container);
  const canCollapse = container.querySelector(':scope > .prix-header') !== null;
  const collapsed = !virtual && state === 'collapsed' && canCollapse;
  container.classList.toggle('prix-collapsed', collapsed);
  container.classList.toggle('prix-hidden', !virtual && state === 'hidden');
  container.classList.toggle('prix-virtual-muted', virtual && state === 'hidden');
  const previous = outerWrappers.get(container);
  const outer = virtual ? container : outerFileWrapper(container);
  if (previous && previous !== outer)
    previous.classList.remove('prix-hidden-outer', 'prix-collapsed-outer');
  if (outer !== container) {
    outer.classList.toggle('prix-hidden-outer', state === 'hidden');
    outer.classList.toggle('prix-collapsed-outer', collapsed);
    outerWrappers.set(container, outer);
  } else outerWrappers.delete(container);
  if (virtual) virtualFiles.apply(container, state);
}

/**
 * Tags the direct child of the container that holds the header, so
 * `.prix-collapsed > :not(.prix-header)` can hide everything else without
 * knowing each view's nesting depth.
 */
function markHeaderChild(container: Element, header: Element): void {
  let node = header;
  while (node.parentElement && node.parentElement !== container) {
    node = node.parentElement;
  }

  if (node.parentElement === container) {
    node.classList.add('prix-header');
  }
}

function scrollPosition(element: Element): string {
  const offsets = [window.scrollX, window.scrollY];
  for (
    let parent = element.parentElement;
    parent && parent !== document.body;
    parent = parent.parentElement
  ) {
    offsets.push(parent.scrollTop, parent.scrollLeft);
  }
  return offsets.join(':');
}

function fileViewportTop(element: Element): number {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (
      parent.scrollHeight > parent.clientHeight &&
      /auto|scroll/.test(getComputedStyle(parent).overflowY)
    )
      return Math.max(100, parent.getBoundingClientRect().top + 1);
  }
  return 100;
}

/** GitHub's viewed/reviewed toggle state for a file container (logged-in only UI). */
function reviewedOf(container: Element): boolean | null {
  if (container.hasAttribute('data-file-user-viewed')) {
    return container.getAttribute('data-file-user-viewed') === 'true';
  }

  const checkbox = container.querySelector<HTMLInputElement>('.js-reviewed-checkbox');
  if (checkbox) {
    return checkbox.checked;
  }

  const toggle = container.querySelector('button[class*="MarkAsViewedButton"]');
  return toggle ? toggle.getAttribute('aria-pressed') === 'true' : null;
}

/** Kill switch: localStorage is reachable from the page console on github.com. */
function isDisabled(): boolean {
  try {
    return localStorage.getItem('prix-disabled') === '1';
  } catch {
    return false;
  }
}

async function init(signal: AbortSignal): Promise<void> {
  if (isDisabled()) {
    console.info('[PR Impact] disabled via localStorage "prix-disabled" - see README');
    return;
  }

  if (!(await loadSettings()).enabled || signal.aborted) return;

  // Fresh page, fresh licence to warn once about bar placement and paths
  barPlacementWarned = false;
  pathExtractionWarned = false;

  // Start the storage read at document_start so a cached count is in memory
  // before the nav mounts - the tab's counter placeholder can then be filled
  // at insert time, before paint.
  void preloadMyPrCounts();

  // Repo-nav feature runs on every repo page, not just PR files pages.
  // Idempotent; also re-evaluates the tab's selected state per navigation.
  // (ensureMyPrsTab is internally try/catch-guarded.)
  ensureMyPrsTab();
  // The nav mounts late and gets re-rendered by turbo/React partials, and a
  // seen-once observer misses losses that don't produce a fresh PR tab node -
  // enforce the tab invariant on relevant nav mutations for the page's lifetime
  // (converges to zero DOM writes when the invariant holds).
  watchMyPrsTab(signal);

  const match = PR_PAGE_RE.exec(location.pathname);
  if (!match) {
    return;
  }

  const [, owner, repo, prNumber, view] = match;
  if (!view) {
    await initOverview(owner, repo, prNumber, signal);
    return;
  }
  const inventoryRequest = fetchInventory(new URL(location.href), signal);
  const virtualFiles = new VirtualFiles(signal);
  const virtualMode =
    view === 'changes' && new URLSearchParams(location.search).get('mode') === 'virtualization';
  const repoKey = `${owner}/${repo}`;
  const store = new CategoryStateStore(repoKey);
  const preferences = new ReviewPreferences(repoKey);
  const [config] = await Promise.all([
    fetchConfig(owner, repo),
    store.load(),
    preferences.load(signal),
  ]);
  if (!signal.aborted) store.watch(signal);
  const rules: CompiledRule[] = compileRules(config.rules);
  if (signal.aborted) {
    return;
  }

  // Bar lists categories in config order, then the implicit `code` category.
  const categories = [...new Set([...rules.map((rule) => rule.name), 'code'])];

  const stateOf = (category: string): DisplayState =>
    store.get(
      category,
      preferences.global.defaultStates[category] ??
        defaultStateFor(category, rules, config.defaultView),
    );

  // Per-PR aggregate cache: seed the bar's display from the last visit
  // (matching head and base SHAs) so a virtualised PR
  // doesn't start at 0 and grow as you scroll. Live counts take over once
  // they cover at least as many files; the two are never summed.
  // Range/config changes describe a different set of files and categories.
  const cacheBase = `${prCacheKey(owner, repo, prNumber)}:${location.pathname.split('/').slice(6).join('/')}:${location.search}:${JSON.stringify(config)}`;
  const cacheKey = (): string =>
    `${cacheBase}:${JSON.stringify(Object.entries(preferences.repo.classifications).sort(([a], [b]) => a.localeCompare(b)))}`;
  const seedKey = cacheKey();
  const pageSha = extractHeadSha(document);
  const pageBaseSha = extractBaseSha(document);
  const cacheEntry = await readPrCounts(seedKey);
  const seed = cacheEntry && isCacheFresh(cacheEntry, pageSha, pageBaseSha) ? cacheEntry : null;
  if (signal.aborted) {
    return;
  }

  const categoryOf = (path: string): string => {
    const override = preferences.repo.classifications[path];
    return override && categories.includes(override) ? override : classify(path, rules);
  };
  const overrides = new Map<string, DisplayState>();
  let directory = '';
  let inventoryPaths: Set<string> | null = null;
  let inventoryOrder: string[] = [];
  let coverage = 'Loading full PR inventory…';
  let pendingReveal: string | null = null;
  let revealVersion = 0;
  const index = new FileIndex();
  const effectiveState = (path: string, category = categoryOf(path)): DisplayState => {
    if (directory && !path.startsWith(`${directory}/`)) return 'hidden';
    const override = overrides.get(path);
    if (override) return override;
    if (preferences.unreviewed && index.files.get(path)?.viewed) return 'hidden';
    return stateOf(category);
  };
  const counts = index.counts;
  const processed = new WeakMap<Element, {path: string; category: string}>();
  const processedById = new Map<string, {category: string}>();
  let impactMap: ImpactMap | null = seed?.impactMap ?? null;
  let lastJump: {path: string; target: Element; position: string} | null = null;
  let virtualCursor: string | null = null;

  const jump = (direction: 1 | -1): void => {
    const containers = [...document.querySelectorAll(containerSelector)].filter((el) => {
      const entry = processed.get(el);
      return (
        entry &&
        effectiveState(entry.path, entry.category) !== 'hidden' &&
        (!preferences.unreviewed || !index.files.get(entry.path)?.viewed)
      );
    });
    if (virtualMode && inventoryOrder.length) {
      const selected = containers.find((element) => processed.get(element)?.path === virtualCursor);
      const current =
        virtualCursor && (!lastJump || (selected && scrollPosition(selected) === lastJump.position))
          ? virtualCursor
          : processed.get(
              containers.findLast((el) => el.getBoundingClientRect().top <= fileViewportTop(el)) ??
                containers[0],
            )?.path;
      const cursor = current ? inventoryOrder.indexOf(current) : -1;
      const candidates =
        direction === 1
          ? inventoryOrder.slice(cursor + 1)
          : inventoryOrder.slice(0, Math.max(0, cursor)).reverse();
      const target = candidates.find(
        (path) =>
          effectiveState(path) !== 'hidden' &&
          (!preferences.unreviewed || !index.files.get(path)?.viewed),
      );
      if (target) openFile(target);
      return;
    }
    if (containers.length === 0) {
      return;
    }

    // "Current" file = last one whose top entered the viewport; then step one
    // file in the requested direction (clamped, no wrap). Threshold 80px:
    // GitHub gives containers ~60px scroll-margin-top, so after a jump the
    // current file's top sits at ~60, and collapsed headers are ~45px tall.
    // At the bottom of a short/collapsed diff the browser cannot place the
    // target at the viewport top. Retain our target until the user scrolls.
    const previousIndex =
      lastJump && scrollPosition(lastJump.target) === lastJump.position
        ? containers.indexOf(lastJump.target)
        : -1;
    const currentIndex =
      previousIndex >= 0
        ? previousIndex
        : containers.findLastIndex((el) => el.getBoundingClientRect().top <= 80);
    const targetIndex = Math.min(Math.max(currentIndex + direction, 0), containers.length - 1);
    if (targetIndex === currentIndex) {
      return;
    }

    const target = containers[targetIndex];
    target.scrollIntoView({block: 'start'});
    lastJump = {path: processed.get(target)!.path, target, position: scrollPosition(target)};
    for (const el of containers) {
      el.classList.remove('prix-flash');
    }

    void (target as HTMLElement).offsetWidth; // restart the animation
    target.classList.add('prix-flash');
  };

  const copyReport = async (): Promise<void> => {
    let rows: Array<{name: string; files: number; added: number; removed: number; share: number}>;
    if (impactMap && !preferences.excludeComments) {
      rows = impactMap.categories;
    } else {
      let totalLines = 0;
      const reportCounts = Object.fromEntries(panelCounts());
      for (const count of Object.values(reportCounts)) {
        totalLines += count.added + count.removed;
      }

      rows = categories.map((name) => {
        const count = reportCounts[name] ?? {files: 0, added: 0, removed: 0, reviewed: 0};
        const lines = count.added + count.removed;
        return {
          name,
          files: count.files,
          added: count.added,
          removed: count.removed,
          share: totalLines > 0 ? (lines / totalLines) * 100 : 0,
        };
      });
    }

    await navigator.clipboard.writeText(buildMarkdownReport(rows));
  };

  const bar = new ImpactBar(categories, {
    onCycle: (category) => {
      store.cycle(category, stateOf(category));
    },
    onExpandAll: () => {
      overrides.clear();
      directory = '';
      void preferences
        .update({unreviewed: false})
        .catch(() => reviewTools.announce('Couldn’t save this preference.'));
      store.setMany(categories.map((category) => [category, 'visible']));
      applyAll();
    },
    onCollapseAll: () => {
      overrides.clear();
      store.setMany(categories.map((category) => [category, 'collapsed']));
      applyAll();
    },
    onFocus: () => {
      overrides.clear();
      store.setMany(
        categories.map((category) => [category, category === 'code' ? 'visible' : 'collapsed']),
      );
      applyAll();
    },
    onCopy: copyReport,
    onJump: jump,
  });
  if (virtualMode) {
    const note = document.createElement('p');
    note.className = 'prix-view-note';
    note.textContent =
      'Virtualized view: filtered files keep a collapsed header so scrolling stays stable.';
    bar.element.querySelector('.prix-bar-footer')!.before(note);
  }
  if (seed?.impactMap) {
    bar.setImpactMap(seed.impactMap); // instant on revisit; the live fetch still wins when it lands
  }

  // The best-known picture: cached until live catches up. Persisting this
  // (rather than raw live counts) means a half-mounted virtualised revisit
  // can never degrade the cache.
  const bestCounts = (): Record<string, CategoryCount> =>
    inventoryPaths || seedKey !== cacheKey()
      ? Object.fromEntries(counts)
      : displayCounts(seed?.counts ?? null, Object.fromEntries(counts));
  const panelCounts = (): Map<string, CategoryCount> =>
    preferences.excludeComments ? index.countsFor(true) : new Map(Object.entries(bestCounts()));

  let lastPersist = 0;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const persist = (): void => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }

    const best = bestCounts();
    if (Object.keys(best).length === 0) {
      return; // never overwrite a good cache with nothing
    }

    lastPersist = Date.now();
    void writePrCounts(cacheKey(), {
      sha: pageSha,
      baseSha: pageBaseSha,
      counts: best,
      impactMap,
      ts: lastPersist,
    });
  };
  const schedulePersist = (): void => {
    const wait = 2000 - (Date.now() - lastPersist);
    if (wait <= 0) {
      persist();
      return;
    }

    persistTimer ??= setTimeout(persist, wait);
  };
  window.addEventListener('pagehide', persist, {signal});
  document.addEventListener('turbo:before-fetch-request', persist, {signal});

  const reviewTools = new ReviewTools(
    {
      unreviewed: (value) => {
        void preferences
          .update({unreviewed: value})
          .catch(() => reviewTools.announce('Couldn’t save this preference.'));
      },
      comments: (value) => {
        void preferences
          .update({excludeComments: value})
          .catch(() => reviewTools.announce('Couldn’t save this preference.'));
      },
      clearOverrides: () => {
        overrides.clear();
        applyAll();
      },
      focusDirectory: (path) => {
        directory = path;
        applyAll();
      },
      openFile: (path) => openFile(path),
      savePreset: async (name) => {
        const existing = preferences.repo.presets.filter((preset) => preset.name !== name);
        if (existing.length >= 20)
          throw new Error('You can save 20 views per repository. Delete a view first.');
        await preferences.update({
          presets: [
            ...existing,
            {
              name,
              states: Object.fromEntries(
                categories.map((category) => [category, stateOf(category)]),
              ),
              unreviewed: preferences.unreviewed,
              excludeComments: preferences.excludeComments,
              directory,
            },
          ],
        });
      },
      applyPreset: (name) => {
        const preset = preferences.repo.presets.find((preset) => preset.name === name);
        if (!preset) return;
        overrides.clear();
        directory = preset.directory;
        store.setMany(
          categories.map((category) => [category, preset.states[category] ?? stateOf(category)]),
        );
        void preferences
          .update({unreviewed: preset.unreviewed, excludeComments: preset.excludeComments})
          .catch(() => reviewTools.announce('Couldn’t save this preference.'));
        applyAll();
      },
      deletePreset: async (name) => {
        await preferences.update({
          presets: preferences.repo.presets.filter((preset) => preset.name !== name),
        });
      },
    },
    signal,
    repoKey,
  );
  bar.element.querySelector('.prix-bar-footer')!.before(reviewTools.element);
  const retryInventory = document.createElement('button');
  retryInventory.type = 'button';
  retryInventory.className = 'prix-filter-reset';
  retryInventory.textContent = 'Retry full counts';
  retryInventory.hidden = true;
  retryInventory.addEventListener('click', () => {
    retryInventory.hidden = true;
    coverage = 'Loading full PR inventory…';
    refreshBar();
    loadInventory(fetchInventory(new URL(location.href), signal));
  });
  reviewTools.element.querySelector('.prix-coverage')!.after(retryInventory);
  const refreshBar = rafThrottled(() => {
    const shown = index.countsFor(
      preferences.excludeComments,
      (path) => effectiveState(path) === 'visible',
    );
    bar.update(
      panelCounts(),
      stateOf,
      shown,
      [...index.files.values()].every((file) => file.lines !== null),
    );
    bar.setImpactMap(preferences.excludeComments ? null : impactMap);
    const commentCount = preferences.excludeComments
      ? [...index.files.values()].reduce(
          (sum, file) =>
            sum + (file.inventory?.commentAdded ?? 0) + (file.inventory?.commentRemoved ?? 0),
          0,
        )
      : 0;
    reviewTools.update({
      unreviewed: preferences.unreviewed,
      excludeComments: preferences.excludeComments,
      overrides: overrides.size,
      directory,
      presets: preferences.repo.presets,
      coverage:
        coverage +
        (preferences.excludeComments
          ? inventoryPaths
            ? ` · ${commentCount.toLocaleString()} comment-only lines excluded`
            : ' · comment counts unavailable for unloaded diffs'
          : ''),
      files: [...index.files].map(([path, file]) => ({
        path,
        category: file.category,
        ...adjustedLines(file, preferences.excludeComments),
        viewed: file.viewed,
        state: effectiveState(path),
        linesKnown: file.lines !== null,
      })),
    });
    schedulePersist();
  }, signal);
  signal.addEventListener(
    'abort',
    () => {
      persist();
      bar.destroy();
    },
    {once: true},
  );

  // Language "PR Impact Map" from the conversation page, when the bot posted one
  void fetchImpactMap(owner, repo, prNumber, pageSha)
    .then(
      guarded('impact-map', (map) => {
        if (!signal.aborted) {
          impactMap = map;
          bar.setImpactMap(preferences.excludeComments ? null : map);
          schedulePersist();
        }
      }),
    )
    .catch((error) => {
      logError('impact-map', error);
    });

  // Tree rows classify by their full path when the tree carries one (works
  // from first paint, even for files the diff hasn't mounted); the
  // container-anchor match is the fallback, and unknown rows stay normal.
  const stateOfTreeRow = (row: Element): DisplayState | null => {
    const path = treeRowPath(row);
    if (path) {
      return effectiveState(path);
    }

    const id = treeRowContainerId(row);
    const entry = id ? processedById.get(id) : undefined;
    return entry ? stateOf(entry.category) : null;
  };

  const applyTreeRow = (row: Element): void => {
    const path = treeRowPath(row);
    const category = path
      ? categoryOf(path)
      : processedById.get(treeRowContainerId(row) ?? '')?.category;
    if (!category) {
      return;
    }

    const state = path ? effectiveState(path, category) : stateOf(category);
    if (path) {
      fileRowStates.set(path, state);
    }

    applyTreeRowState(row, category, state);
  };

  // Folder rollup: a folder whose classified descendant files are all faded
  // gets faded too, and its disclosure closed once per folder per page (the
  // fade itself re-applies freely). Unknown files count as visible. Prefix
  // matching over known file paths where rows carry them (React TreeView
  // row ids); the classic nested-<ul> walk is the fallback.
  const userToggledFolders = new Set<string>();
  const autoCollapsedFolders = new Set<string>();
  const fileRowStates = new Map<string, DisplayState>();
  const recomputeFolderStates = rafThrottled(() => {
    for (const row of document.querySelectorAll(TREE_ROW_SELECTOR)) {
      if (!isFolderRow(row)) {
        continue;
      }

      const key = folderKey(row);
      const byPath = key ? folderStatesByPath(key, fileRowStates) : [];
      const state =
        byPath.length > 0
          ? aggregateFolderState(byPath)
          : aggregateFolderState(folderFileStates(row, stateOfTreeRow));
      applyFolderState(row, state);
      maybeAutoCollapseFolder(row, state, userToggledFolders, autoCollapsedFolders);
    }
  }, signal);

  // A folder the user has opened or closed by hand is never auto-collapsed
  document.addEventListener(
    'click',
    guarded('folder-toggle', (event: MouseEvent) => {
      const control = (event.target as Element).closest?.('[aria-expanded]');
      const row = control?.closest(TREE_ROW_SELECTOR);
      if (!control || !row) {
        return;
      }

      const key = folderKey(row);
      if (key) {
        userToggledFolders.add(key);
      }
    }),
    {signal},
  );

  const applyAll = (): void => {
    for (const [path, file] of index.files) {
      const category = categoryOf(path);
      if (category !== file.category) index.update(path, category, null, null);
    }
    for (const container of document.querySelectorAll(containerSelector)) {
      const entry = processed.get(container);
      if (!entry) continue;
      entry.category = categoryOf(entry.path);
      applyState(container, effectiveState(entry.path, entry.category), virtualFiles);
      const header = adapterFor(container)?.getHeader(container);
      if (header) decorateHeader(header, entry.path, entry.category);
    }
    for (const row of document.querySelectorAll(TREE_ROW_SELECTOR))
      if (!isFolderRow(row)) applyTreeRow(row);
    recomputeFolderStates();
    refreshBar();
  };
  store.subscribe(applyAll);
  preferences.subscribe(applyAll);

  const decorateHeader = (header: Element, path: string, category: string): void => {
    injectBadge(header, category);
    injectFileControls(header, {
      category,
      categories,
      explanation: explainClassification(path, rules, preferences.repo.classifications[path]),
      overriddenCategory: preferences.repo.classifications[path],
      override: overrides.get(path),
      state: effectiveState(path, category),
      onState: (state) => {
        if (state) overrides.set(path, state);
        else overrides.delete(path);
        applyAll();
      },
      onCategory: (category) => {
        const classifications = {...preferences.repo.classifications};
        if (category) classifications[path] = category;
        else delete classifications[path];
        void preferences
          .update({classifications})
          .catch(() => reviewTools.announce('Couldn’t save the category correction.'));
      },
    });
  };
  const openFile = (path: string): void => {
    if (virtualMode) {
      // Keep the selected path while React loads/expands it and recycles its DOM.
      virtualCursor = path;
      lastJump = null;
    }
    if (directory && !path.startsWith(`${directory}/`)) directory = '';
    overrides.set(path, 'visible');
    applyAll();
    const container = [...document.querySelectorAll(containerSelector)].find(
      (element) => processed.get(element)?.path === path,
    );
    const version = ++revealVersion;
    if (container) {
      const reveal = (): void => {
        if (signal.aborted || version !== revealVersion) return;
        // React can recycle the original element while committing the expansion.
        const target = [...document.querySelectorAll(containerSelector)].find(
          (element) => adapterFor(element)?.getPath(element) === path,
        );
        if (!target) {
          pendingReveal = path;
          return;
        }
        target.scrollIntoView({block: 'start'});
        target.classList.add('prix-flash');
        lastJump = {path, target, position: scrollPosition(target)};
        pendingReveal = null;
      };
      if (isVirtualFile(container)) requestAnimationFrame(() => requestAnimationFrame(reveal));
      else reveal();
    } else {
      pendingReveal = path;
      const row = [...document.querySelectorAll(TREE_ROW_SELECTOR)].find(
        (row) => treeRowPath(row) === path,
      );
      const anchor = row?.querySelector<HTMLAnchorElement>('a[href*="#diff-"]');
      if (anchor) anchor.click();
      else if (row instanceof HTMLElement) row.click();
      else
        void fileAnchor(path)
          .then((hash) => {
            if (!signal.aborted) location.hash = hash;
          })
          .catch(() => {});
      reviewTools.announce(
        `Selected ${path}. If it hasn’t loaded yet, use GitHub’s file tree or scroll to bring it into view.`,
      );
    }
  };
  document.addEventListener(
    'click',
    (event) => {
      const row = (event.target as Element).closest?.(TREE_ROW_SELECTOR);
      const path = row && !isFolderRow(row) ? treeRowPath(row) : null;
      if (path && effectiveState(path) !== 'visible') {
        if (directory && !path.startsWith(`${directory}/`)) directory = '';
        overrides.set(path, 'visible');
        applyAll();
      }
    },
    {signal},
  );

  document.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted) return;
      const target = event.target instanceof Element ? event.target : null;
      const container = target?.closest(containerSelector);
      if (!container || !isVirtualFile(container)) return;
      const toggle = nativeFileToggle(container);
      const entry = processed.get(container);
      if (!toggle || !entry || !toggle.contains(target)) return;
      const expanded = isFileExpanded(toggle);
      if (expanded === null) return;
      virtualFiles.userToggle(container, !expanded);
      overrides.set(entry.path, expanded ? 'collapsed' : 'visible');
      requestAnimationFrame(() => {
        if (!signal.aborted) applyAll();
      });
    },
    {signal, capture: true},
  );

  // Shift+J/K jumps between visible files. GitHub binds no j/k variants on
  // the files page (checked: only g-c/g-i/g-p/g-a/g-s/t/c/i/a), so no conflict.
  document.addEventListener(
    'keydown',
    guarded('keydown', (event: KeyboardEvent) => {
      if (
        !event.shiftKey ||
        event.defaultPrevented ||
        (event.key !== 'J' && event.key !== 'K') ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }

      if (
        (event.target as HTMLElement).closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
        )
      ) {
        return;
      }

      event.preventDefault();
      jump(event.key === 'J' ? 1 : -1);
    }),
    {signal},
  );

  // Read the actual reviewed state, including async React updates, without a
  // fixed delay that can race the network or outlive navigation.
  const updateReviewed = (container: Element): void => {
    const entry = processed.get(container);
    if (!entry) return;
    const record = index.files.get(entry.path)!;
    const viewed = reviewedOf(container);
    if (viewed !== null && viewed !== record.viewed) {
      index.update(entry.path, entry.category, null, viewed);
      applyAll();
    }
  };
  document.addEventListener(
    'change',
    guarded('reviewed-change', (event: Event) => {
      const container = (event.target as Element).closest?.(containerSelector);
      if (container) updateReviewed(container);
    }),
    {signal},
  );
  const reviewedObserver = new MutationObserver((mutations) => {
    const changed = new Set<Element>();
    for (const mutation of mutations) {
      const container = (mutation.target as Element).closest(containerSelector);
      if (container) changed.add(container);
    }
    for (const container of changed) updateReviewed(container);
  });
  reviewedObserver.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-pressed', 'data-file-user-viewed', 'checked'],
  });
  signal.addEventListener('abort', () => reviewedObserver.disconnect(), {once: true});

  // (No separate toolbar watcher: the bar is inserted when the first file
  // container is processed - an unknown-DOM page must yield zero injections.)

  // Full per-file processing. Containers are often observed in their loading
  // skeleton (aria-label "Loading <path>", no header or stats mounted yet) -
  // the header observer below re-enters here once the real header exists.
  // Counts use file paths so virtualized remounts update the same record.
  const processContainer = (container: Element): void => {
    // Plausibility guard: never classify/state a page-level wrapper that
    // happens to match the prefix selector (contains real containers inside).
    // Expected on every page (diff-layout-component matches div[id^="diff-"]),
    // so this is a debug-level note, not an error.
    if (!isFileContainer(container)) {
      console.debug(
        '[PR Impact]',
        'skipped implausible container',
        container.id || container.className,
      );
      return;
    }

    const adapter = adapterFor(container);
    const path = adapter?.getPath(container);
    if (!adapter || !path) {
      // A plausible container with no extractable path means GitHub changed
      // the header markup - say so once, with enough markup to fix the
      // selector, instead of silently doing nothing all page.
      if (!pathExtractionWarned) {
        pathExtractionWarned = true;
        console.warn(
          '[PR Impact]',
          `no file path extractable from a ${adapter?.name ?? 'unrecognised'} container - GitHub may have changed the diff header markup.`,
          `container: ${markupSnippet(container)}`,
        );
      }

      return;
    }

    const header = adapter.getHeader(container);
    if (header) {
      markHeaderChild(container, header);
    }

    const previous = processed.get(container);
    if (previous && previous.path !== path) virtualFiles.forget(container);
    if (location.hash === `#${container.id}` && previous?.path !== path)
      overrides.set(path, 'visible');
    const category = categoryOf(path);
    const lines = adapter.getChangedLines(container);
    const viewed = reviewedOf(container);
    index.update(path, category, lines, viewed);

    if (header) {
      decorateHeader(header, path, category);
    }

    processed.set(container, {path, category});
    if (container.id) {
      processedById.set(container.id, {category});
      // A tree row seen before its file mounted gets classified now
      const row =
        document.getElementById(`file-tree-item-${container.id}`) ??
        document.getElementById(path) ??
        [...document.querySelectorAll(TREE_ROW_SELECTOR)].find(
          (candidate) => treeRowContainerId(candidate) === container.id,
        );
      if (row) {
        applyTreeRow(row);
      }

      recomputeFolderStates();
    }

    applyState(container, effectiveState(path, category), virtualFiles);
    if (inventoryPaths && !inventoryPaths.has(path)) {
      inventoryPaths = null;
      coverage = 'Files changed since inventory loaded · showing discovered files';
    }
    if (pendingReveal === path) {
      pendingReveal = null;
      requestAnimationFrame(() => {
        if (!signal.aborted) openFile(path);
      });
    }

    insertBar(bar);
    refreshBar();
  };

  observeFiles(processContainer, signal);

  observeSelector(
    TREE_ROW_SELECTOR,
    (row) => {
      if (isFolderRow(row)) {
        recomputeFolderStates();
        return;
      }

      applyTreeRow(row);
      recomputeFolderStates();
    },
    signal,
  );

  // Keep one panel through same-URL React replacements, including an empty diff.
  const mountBar = rafThrottled(() => insertBar(bar), signal);
  const placementObserver = new MutationObserver(() => {
    if (!bar.element.isConnected) mountBar();
  });
  placementObserver.observe(document.documentElement, {subtree: true, childList: true});
  signal.addEventListener('abort', () => placementObserver.disconnect(), {once: true});
  observeSelector(
    PR_NAV_SELECTOR + ', .pr-toolbar, section[class*="PullRequestFilesToolbar"]',
    () => mountBar(),
    signal,
  );
  mountBar();
  const loadInventory = (request: ReturnType<typeof fetchInventory>): void => {
    void request
      .then((result) => {
        if (signal.aborted) return;
        if (result.inventory?.complete) {
          inventoryOrder = result.inventory.files.map((file) => file.path);
          const paths = new Set(inventoryOrder);
          const consistent = [...index.files.keys()].every((path) => paths.has(path));
          index.seed(result.inventory.files, categoryOf);
          inventoryPaths = consistent ? paths : null;
          coverage = consistent
            ? `Complete PR inventory · ${paths.size} files`
            : 'Diff and page differ · showing discovered files';
          applyAll();
        } else {
          coverage = result.reason ?? 'Counts cover files loaded so far';
          retryInventory.hidden = !diffPathForPage(new URL(location.href));
          refreshBar();
        }
      })
      .catch(() => {
        if (!signal.aborted) {
          coverage = 'Full diff unavailable · counts cover loaded files';
          retryInventory.hidden = false;
          refreshBar();
        }
      });
  };
  loadInventory(inventoryRequest);
}

function run(): void {
  let controller: AbortController | null = null;
  let currentUrl = '';
  const stop = (): void => {
    controller?.abort();
    controller = null;
    for (const element of document.querySelectorAll(
      '.prix-collapsed, .prix-hidden, .prix-hidden-outer, .prix-collapsed-outer, .prix-header, .prix-flash, .prix-tree-collapsed, .prix-tree-hidden, .prix-virtual-muted',
    )) {
      element.classList.remove(
        'prix-collapsed',
        'prix-hidden',
        'prix-hidden-outer',
        'prix-collapsed-outer',
        'prix-header',
        'prix-flash',
        'prix-tree-collapsed',
        'prix-tree-hidden',
        'prix-virtual-muted',
      );
    }
    for (const element of document.querySelectorAll(
      '#prix-bar, .prix-badge, .prix-file-controls, .prix-tree-badge',
    ))
      element.remove();
    for (const id of ['my-prs-repo-tab', 'review-requested-repo-tab'])
      document.getElementById(id)?.closest('li')?.remove();
  };
  const start = (): void => {
    // Turbo can announce the same render more than once. Keep one live session.
    // GitHub's file-tree anchors change only the hash. Those are review jumps,
    // not page navigations, and must preserve per-file overrides and the queue.
    const url = location.origin + location.pathname + location.search;
    if (controller && currentUrl === url) return;
    stop();
    currentUrl = url;
    controller = new AbortController();
    void init(controller.signal).catch((error) => logError('init', error));
  };
  document.addEventListener('turbo:before-render', stop);
  document.addEventListener('turbo:before-cache', stop);
  document.addEventListener('turbo:render', start);
  document.addEventListener('soft-nav:react-done', start);
  window.addEventListener('popstate', start);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', start);
  browser.storage.onChanged.addListener((changes, area) => {
    if (
      area === 'local' &&
      changes[SETTINGS_KEY] &&
      parseSettings(changes[SETTINGS_KEY].newValue).enabled !==
        parseSettings(changes[SETTINGS_KEY].oldValue).enabled
    ) {
      stop();
      start();
    }
  });
  start();
}

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_start',
  cssInjectionMode: 'manifest',
  main() {
    // Guard against double-injection (e.g. bfcache restores)
    if (document.documentElement.hasAttribute('data-prix-active')) {
      return;
    }

    document.documentElement.setAttribute('data-prix-active', '');
    run();
  },
});
