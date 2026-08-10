import './content.css';
import {defineContentScript} from 'wxt/utils/define-content-script';
import {actionFor, classify, compileRules, type CompiledRule} from '../lib/classifier';
import {fetchConfig} from '../lib/config';
import {ImpactBar, type CategoryCount} from '../lib/impact-bar';
import {buildMarkdownReport, fetchImpactMap, type ImpactMap} from '../lib/impact-report';
import {injectBadge} from '../lib/badges';
import {applyTreeRowState, TREE_ROW_SELECTOR, treeRowContainerId} from '../lib/file-tree';
import {ensureMyPrsTab, preloadMyPrCounts, watchMyPrsTab} from '../lib/my-prs-tab';
import {observeSelector} from '../lib/observer';
import {guarded, logError, rafThrottled} from '../lib/safe';
import {actionToState, CategoryStateStore, type DisplayState} from '../lib/state';
import {adapterFor, containerSelector, headerSelector, isFileContainer} from '../lib/views';

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

/** Anchor for the impact bar: after the files toolbar, else before the first file container. */
function insertBar(bar: ImpactBar): void {
  if (document.getElementById('prix-bar')) {
    return;
  }

  const toolbar = document.querySelector(
    'section[class*="PullRequestFilesToolbar-module__toolbar"], .pr-toolbar',
  );
  if (toolbar?.parentElement) {
    toolbar.parentElement.insertBefore(bar.element, toolbar.nextElementSibling);
    return;
  }

  const firstFile = document.querySelector(containerSelector);
  if (firstFile?.parentElement) {
    firstFile.parentElement.insertBefore(bar.element, firstFile);
  }
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
  container.classList.toggle('prix-collapsed', state === 'collapsed' && canCollapse);
  container.classList.toggle('prix-hidden', state === 'hidden');
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
  const rules: CompiledRule[] = compileRules(await fetchConfig(owner, repo));
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
    store.get(category, actionToState(actionFor(category, rules)));

  const counts = new Map<string, CategoryCount>();
  const processed: Array<{container: Element; category: string; viewed: boolean}> = [];
  const processedById = new Map<string, {container: Element; category: string}>();
  const treeRows = new Map<Element, string>(); // row → container id
  const pendingTreeRows = new Map<string, Element[]>(); // container id → rows seen before their file mounted
  let impactMap: ImpactMap | null = null;

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
  const refreshBar = rafThrottled(() => {
    bar.update(counts, stateOf);
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

  store.subscribe(category => {
    const state = stateOf(category);
    for (const entry of processed) {
      if (entry.category === category) {
        applyState(entry.container, state);
      }
    }

    for (const [row, containerId] of treeRows) {
      const entry = processedById.get(containerId);
      if (entry?.category === category) {
        applyTreeRowState(row, category, state);
      }
    }

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
      for (const row of pendingTreeRows.get(container.id) ?? []) {
        treeRows.set(row, container.id);
        applyTreeRowState(row, category, stateOf(category));
      }

      pendingTreeRows.delete(container.id);
    }

    applyState(container, stateOf(category));

    insertBar(bar);
    refreshBar();
  }, signal);

  observeSelector(TREE_ROW_SELECTOR, row => {
    const id = treeRowContainerId(row);
    if (!id) {
      return;
    }

    const entry = processedById.get(id);
    if (entry) {
      treeRows.set(row, id);
      applyTreeRowState(row, entry.category, stateOf(entry.category));
    } else {
      // Tree renders before lazily-mounted files; flush when the file mounts
      const pending = pendingTreeRows.get(id) ?? [];
      pending.push(row);
      pendingTreeRows.set(id, pending);
    }
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
