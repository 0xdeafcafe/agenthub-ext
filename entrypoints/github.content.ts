import './content.css';
import {defineContentScript} from 'wxt/utils/define-content-script';
import {classify, compileRules, type CompiledRule} from '../lib/classifier';
import {fetchConfig} from '../lib/config';
import {findBarPlacement, ImpactBar, PR_HEADER_PROBE, spanningBarPlacement, type CategoryCount} from '../lib/impact-bar';
import {buildMarkdownReport, fetchImpactMap, type ImpactMap} from '../lib/impact-report';
import {injectBadge} from '../lib/badges';
import {
  aggregateFolderState,
  applyFolderState,
  applyTreeRowState,
  folderFileStates,
  folderKey,
  isFolderRow,
  maybeAutoCollapseFolder,
  TREE_ROW_SELECTOR,
  treeRowContainerId,
  treeRowPath,
} from '../lib/file-tree';
import {ensureMyPrsTab, preloadMyPrCounts, watchMyPrsTab} from '../lib/my-prs-tab';
import {displayCounts, extractHeadSha, isCacheFresh, prCacheKey, readPrCounts, writePrCounts} from '../lib/pr-cache';
import {observeSelector} from '../lib/observer';
import {guarded, logError, rafThrottled} from '../lib/safe';
import {defaultStateFor, CategoryStateStore, type DisplayState} from '../lib/state';
import {adapterFor, containerSelector, headerSelector, isFileContainer, outerFileWrapper} from '../lib/views';

// Matches /pull/:n/files and /pull/:n/changes (incl. /changes/<sha>..<sha>).
// Local regex instead of github-url-detection: the installed version's
// isPRFiles does not cover the /changes route.
const PR_FILES_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:files|changes)(?:\/|$)/;

function oneEvent(target: EventTarget, events: string[]): Promise<true> {
  return new Promise(resolve => {
    const handler = (): void => {
      for (const event of events) {
        target.removeEventListener(event, handler);
      }

      resolve(true);
    };

    for (const event of events) {
      target.addEventListener(event, handler);
    }
  });
}

/**
 * The files toolbar, found as defensively as we can: the module-class
 * section, then anything with the toolbar class fragment, then by content
 * (the "N / M viewed" counter lives in it, as does Submit review).
 */
function findFilesToolbar(): Element | null {
  const byClass =
    document.querySelector('section[class*="PullRequestFilesToolbar-module__toolbar"], .pr-toolbar') ??
    document.querySelector('[class*="PullRequestFilesToolbar"]');
  if (byClass) {
    return byClass;
  }

  for (const element of document.querySelectorAll('span, div, button')) {
    if (element.children.length > 0) {
      continue;
    }

    if (/\d[\d,]*\s*\/\s*\d[\d,]*\s*viewed/.test(element.textContent ?? '') || element.textContent?.trim() === 'Submit review') {
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
    parts.push(`${el.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''} ${display}/${flexWrap}${probe}`);
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

  const toolbar = findFilesToolbar();
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
        anchor ? `anchor chain: ${describeAnchorChain(anchor)}` : 'no anchor found (no toolbar, no file container)',
      );
    }

    return;
  }

  placement.parent.insertBefore(bar.element, placement.before);
}

function applyState(container: Element, state: DisplayState): void {
  // Over-match guard: state classes only ever land on plausible file containers
  if (!isFileContainer(container)) {
    logError('applyState refused a non-file-container element', container.tagName);
    return;
  }

  // Collapsing only works once a header child is tagged - otherwise the CSS
  // would hide every child. Fall back to visible rather than blank the file.
  const canCollapse = container.querySelector(':scope > .prix-header') !== null;
  const collapsed = state === 'collapsed' && canCollapse;
  container.classList.toggle('prix-collapsed', collapsed);
  container.classList.toggle('prix-hidden', state === 'hidden');

  // State goes on the outermost per-file wrapper too: in the React view the
  // container can sit in a row/slot that keeps its own height, so hiding or
  // collapsing only the container leaves scroll space behind. Strip our
  // outer classes from any previous wrapper first - sibling mounts can move
  // the boundary between calls.
  const previous = container.closest('.prix-hidden-outer, .prix-collapsed-outer');
  previous?.classList.remove('prix-hidden-outer', 'prix-collapsed-outer');

  const outer = outerFileWrapper(container);
  if (outer !== container) {
    outer.classList.toggle('prix-hidden-outer', state === 'hidden');
    outer.classList.toggle('prix-collapsed-outer', collapsed);
  }
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

/** GitHub's viewed/reviewed toggle state for a file container (logged-in only UI). */
function reviewedOf(container: Element): boolean {
  if (container.getAttribute('data-file-user-viewed') === 'true') {
    return true;
  }

  const checkbox = container.querySelector<HTMLInputElement>('.js-reviewed-checkbox');
  if (checkbox) {
    return checkbox.checked;
  }

  return container.querySelector('button[class*="MarkAsViewedButton"]')?.getAttribute('aria-pressed') === 'true';
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
  // enforce the tab invariant on every mutation batch for the page's lifetime
  // (converges to zero DOM writes when the invariant holds).
  watchMyPrsTab(signal);

  const match = PR_FILES_RE.exec(location.pathname);
  if (!match) {
    return;
  }

  const [, owner, repo, prNumber] = match;
  const config = await fetchConfig(owner, repo);
  const rules: CompiledRule[] = compileRules(config.rules);
  if (signal.aborted) {
    return;
  }

  // Bar lists categories in config order, then the implicit `code` category.
  const categories = [...rules.map(rule => rule.name), 'code'];
  const store = new CategoryStateStore();
  await store.load();
  if (signal.aborted) {
    return;
  }

  const stateOf = (category: string): DisplayState =>
    store.get(category, defaultStateFor(category, rules, config.defaultView));

  // Per-PR aggregate cache: seed the bar's display from the last visit
  // (same head SHA, or no SHA to compare against) so a virtualised PR
  // doesn't start at 0 and grow as you scroll. Live counts take over once
  // they cover at least as many files; the two are never summed.
  const cacheKey = prCacheKey(owner, repo, prNumber);
  const pageSha = extractHeadSha(document);
  const cacheEntry = await readPrCounts(cacheKey);
  const seed = cacheEntry && isCacheFresh(cacheEntry, pageSha) ? cacheEntry : null;
  if (signal.aborted) {
    return;
  }

  const counts = new Map<string, CategoryCount>();
  const processed: Array<{container: Element; category: string; viewed: boolean}> = [];
  const processedById = new Map<string, {container: Element; category: string}>();
  const treeFileRows = new Set<Element>(); // every file row seen this page
  let impactMap: ImpactMap | null = seed?.impactMap ?? null;

  const jump = (direction: 1 | -1): void => {
    const jumpable = new Set(
      processed.filter(entry => stateOf(entry.category) !== 'hidden').map(entry => entry.container),
    );
    const containers = [...document.querySelectorAll(containerSelector)].filter(el => jumpable.has(el));
    if (containers.length === 0) {
      return;
    }

    // "Current" file = last one whose top entered the viewport; then step one
    // file in the requested direction (clamped, no wrap). Threshold 80px:
    // GitHub gives containers ~60px scroll-margin-top, so after a jump the
    // current file's top sits at ~60, and collapsed headers are ~45px tall.
    const currentIndex = containers.findLastIndex(el => el.getBoundingClientRect().top <= 80);
    const targetIndex = Math.min(Math.max(currentIndex + direction, 0), containers.length - 1);
    if (targetIndex === currentIndex) {
      return;
    }

    const target = containers[targetIndex];
    target.scrollIntoView({block: 'start'});
    for (const el of containers) {
      el.classList.remove('prix-flash');
    }

    void (target as HTMLElement).offsetWidth; // restart the animation
    target.classList.add('prix-flash');
  };

  const copyReport = async (): Promise<void> => {
    let rows: Array<{name: string; files: number; added: number; removed: number; share: number}>;
    if (impactMap) {
      rows = impactMap.categories;
    } else {
      let totalLines = 0;
      for (const count of counts.values()) {
        totalLines += count.added + count.removed;
      }

      rows = categories.map(name => {
        const count = counts.get(name) ?? {files: 0, added: 0, removed: 0, reviewed: 0};
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

    try {
      await navigator.clipboard.writeText(buildMarkdownReport(rows));
    } catch {
      // Clipboard requires a focused document; nothing sensible to fall back to
    }
  };

  const bar = new ImpactBar(categories, {
    onCycle: category => {
      store.cycle(category, stateOf(category));
    },
    onExpandAll: () => {
      for (const category of categories) {
        store.set(category, 'visible');
      }
    },
    onCollapseAll: () => {
      for (const category of categories) {
        store.set(category, 'collapsed');
      }
    },
    onCopy: () => {
      void copyReport();
    },
    onJump: jump,
  });
  if (seed?.impactMap) {
    bar.setImpactMap(seed.impactMap); // instant on revisit; the live fetch still wins when it lands
  }

  // The best-known picture: cached until live catches up. Persisting this
  // (rather than raw live counts) means a half-mounted virtualised revisit
  // can never degrade the cache.
  const bestCounts = (): Record<string, CategoryCount> =>
    displayCounts(seed?.counts ?? null, Object.fromEntries(counts));

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
    void writePrCounts(cacheKey, {sha: pageSha, counts: best, impactMap, ts: lastPersist});
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

  const refreshBar = rafThrottled(() => {
    bar.update(new Map(Object.entries(bestCounts())), stateOf);
    schedulePersist();
  });

  // Language "PR Impact Map" from the conversation page, when the bot posted one
  void fetchImpactMap(owner, repo, prNumber)
    .then(
      guarded('impact-map', map => {
        if (!signal.aborted && map) {
          impactMap = map;
          bar.setImpactMap(map);
        }
      }),
    )
    .catch(error => {
      logError('impact-map', error);
    });

  // Tree rows classify by their full path when the tree carries one (works
  // from first paint, even for files the diff hasn't mounted); the
  // container-anchor match is the fallback, and unknown rows stay normal.
  const stateOfTreeRow = (row: Element): DisplayState | null => {
    const path = treeRowPath(row);
    if (path) {
      return stateOf(classify(path, rules));
    }

    const id = treeRowContainerId(row);
    const entry = id ? processedById.get(id) : undefined;
    return entry ? stateOf(entry.category) : null;
  };

  const applyTreeRow = (row: Element): void => {
    const path = treeRowPath(row);
    const category = path
      ? classify(path, rules)
      : processedById.get(treeRowContainerId(row) ?? '')?.category;
    if (!category) {
      return;
    }

    applyTreeRowState(row, category, stateOf(category));
  };

  // Folder rollup: a folder whose classified descendant files are all faded
  // gets faded too, and its disclosure closed once per folder per page (the
  // fade itself re-applies freely). Unknown files count as visible.
  const userToggledFolders = new Set<string>();
  const autoCollapsedFolders = new Set<string>();
  const recomputeFolderStates = rafThrottled(() => {
    for (const row of document.querySelectorAll(TREE_ROW_SELECTOR)) {
      if (!isFolderRow(row)) {
        continue;
      }

      const state = aggregateFolderState(folderFileStates(row, stateOfTreeRow));
      applyFolderState(row, state);
      maybeAutoCollapseFolder(row, state, userToggledFolders, autoCollapsedFolders);
    }
  });

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

  store.subscribe(category => {
    const state = stateOf(category);
    for (const entry of processed) {
      if (entry.category === category) {
        applyState(entry.container, state);
      }
    }

    for (const row of treeFileRows) {
      applyTreeRow(row);
    }

    recomputeFolderStates();
    refreshBar();
  });

  // Shift+J/K jumps between visible files. GitHub binds no j/k variants on
  // the files page (checked: only g-c/g-i/g-p/g-a/g-s/t/c/i/a), so no conflict.
  document.addEventListener(
    'keydown',
    guarded('keydown', (event: KeyboardEvent) => {
      if ((event.key !== 'J' && event.key !== 'K') || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }

      event.preventDefault();
      jump(event.key === 'J' ? 1 : -1);
    }),
    {signal},
  );

  // Reviewed toggles update via ajax after the click - re-read shortly after
  document.addEventListener(
    'click',
    guarded('reviewed-click', (event: MouseEvent) => {
      const toggle = (event.target as Element).closest?.(
        '.js-reviewed-checkbox, .js-reviewed-toggle, button[class*="MarkAsViewedButton"]',
      );
      const container = toggle?.closest(containerSelector);
      const entry = processed.find(p => p.container === container);
      if (!entry) {
        return;
      }

      setTimeout(() => {
        const now = reviewedOf(entry.container);
        if (now !== entry.viewed) {
          entry.viewed = now;
          const count = counts.get(entry.category);
          if (count) {
            count.reviewed += now ? 1 : -1;
          }

          refreshBar();
        }
      }, 600);
    }),
    {signal},
  );

  // (No separate toolbar watcher: the bar is inserted when the first file
  // container is processed - an unknown-DOM page must yield zero injections.)

  observeSelector(containerSelector, container => {
    // Plausibility guard: never classify/state a page-level wrapper that
    // happens to match the prefix selector (contains real containers inside).
    // Expected on every page (diff-layout-component matches div[id^="diff-"]),
    // so this is a debug-level note, not an error.
    if (!isFileContainer(container)) {
      console.debug('[PR Impact]', 'skipped implausible container', container.id || container.className);
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

    const category = classify(path, rules);
    const lines = adapter.getChangedLines(container);
    const viewed = reviewedOf(container);
    const count = counts.get(category) ?? {files: 0, added: 0, removed: 0, reviewed: 0};
    count.files += 1;
    count.added += lines?.added ?? 0;
    count.removed += lines?.removed ?? 0;
    if (viewed) {
      count.reviewed += 1;
    }

    counts.set(category, count);

    if (header) {
      injectBadge(header, category);
    }

    processed.push({container, category, viewed});
    if (container.id) {
      processedById.set(container.id, {container, category});
      // A tree row seen before its file mounted gets classified now
      const row =
        document.getElementById(`file-tree-item-${container.id}`) ??
        [...treeFileRows].find(candidate => treeRowContainerId(candidate) === container.id);
      if (row) {
        treeFileRows.add(row);
        applyTreeRow(row);
      }

      recomputeFolderStates();
    }

    applyState(container, stateOf(category));

    insertBar(bar);
    refreshBar();
  }, signal);

  observeSelector(TREE_ROW_SELECTOR, row => {
    if (isFolderRow(row)) {
      recomputeFolderStates();
      return;
    }

    treeFileRows.add(row);
    applyTreeRow(row);
    recomputeFolderStates();
  }, signal);

  // React can re-render a file header (e.g. after the viewed toggle), wiping
  // our badge and the .prix-header tag. Headers are observed separately from
  // containers (whose data-prix-seen guard would otherwise block re-apply).
  observeSelector(headerSelector, header => {
    const container = header.closest(containerSelector);
    if (!container?.hasAttribute('data-prix-seen')) {
      return; // container not processed yet - its own pass handles the header
    }

    const entry = processed.find(p => p.container === container);
    if (!entry) {
      return;
    }

    markHeaderChild(container, header);
    injectBadge(header, entry.category);
    applyState(container, stateOf(entry.category));
  }, signal);
}

async function run(): Promise<void> {
  let controller = new AbortController();
  const reset = (): void => {
    controller.abort();
    controller = new AbortController();
  };

  // Tear down observers/listeners before Turbo swaps the page…
  document.addEventListener('turbo:before-fetch-request', reset);
  document.addEventListener('turbo:visit', reset);

  init(controller.signal);
  // …and re-init after every Turbo/React soft navigation.
  while (await oneEvent(document, ['turbo:render', 'soft-nav:react-done'])) {
    init(controller.signal);
  }
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
    void run();
  },
});
