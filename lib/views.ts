/**
 * DOM adapters for GitHub's two coexisting PR files pages:
 * - classic view at /pull/:n/files (div.js-file containers)
 * - new React view at /pull/:n/changes (div[id^="diff-"] containers, hashed CSS-module classes)
 *
 * React-view classes are matched by prefix/contains, never exactly.
 */

export interface ChangedLines {
  added: number;
  removed: number;
}

export interface ViewAdapter {
  name: 'classic' | 'react';
  containerSelector: string;
  /** Matches the header element inside a container (used to re-apply badges after React re-renders). */
  headerSelector: string;
  getPath: (container: Element) => string | null;
  getHeader: (container: Element) => Element | null;
  /** Best-effort; null when unparseable (caller falls back to file counts). */
  getChangedLines: (container: Element) => ChangedLines | null;
}

function parseDiffstatText(text: string): ChangedLines | null {
  const added = /([\d,]+)\s+additions?/.exec(text);
  const removed = /([\d,]+)\s+deletions?/.exec(text);
  if (added ?? removed) {
    return {
      added: added ? Number(added[1].replaceAll(',', '')) : 0,
      removed: removed ? Number(removed[1].replaceAll(',', '')) : 0,
    };
  }

  return null;
}

/**
 * The React files view renders per-file stats in the header as standalone
 * "+58" / "−22" leaf elements (the minus can be U+2212, U+2013 or ASCII).
 * Matched strictly so a file name containing a plus sign can't false-positive.
 */
function parsePlusMinusStats(header: Element): ChangedLines | null {
  let added: number | null = null;
  let removed: number | null = null;
  for (const element of header.querySelectorAll('*')) {
    if (element.children.length > 0) {
      continue; // leaf elements only
    }

    const text = element.textContent?.trim() ?? '';
    let match = /^\+([\d,]+)$/.exec(text);
    if (match) {
      added = Number(match[1].replaceAll(',', ''));
      continue;
    }

    match = /^[−–-]([\d,]+)$/.exec(text);
    if (match) {
      removed = Number(match[1].replaceAll(',', ''));
    }
  }

  return added === null && removed === null ? null : {added: added ?? 0, removed: removed ?? 0};
}

const classicAdapter: ViewAdapter = {
  name: 'classic',
  containerSelector: 'div.js-file',
  headerSelector: '.file-header',
  getPath(container) {
    return (
      container.getAttribute('data-tagsearch-path') ??
      container.querySelector('.file-header')?.getAttribute('data-path') ??
      null
    );
  },
  getHeader(container) {
    return container.querySelector('.file-header');
  },
  getChangedLines(container) {
    // The header's diffstat area carries "N additions & M deletions" in
    // aria-label/title/text depending on the page version - try all of it.
    const header = container.querySelector('.file-header');
    if (header) {
      const labeled = header.querySelector(
        '[aria-label*="addition"], [title*="addition"], [aria-label*="deletion"], [title*="deletion"]',
      );
      const fromLabel = parseDiffstatText(
        labeled?.getAttribute('aria-label') ?? labeled?.getAttribute('title') ?? '',
      );
      if (fromLabel) {
        return fromLabel;
      }

      const fromText = parseDiffstatText(header.textContent ?? '');
      if (fromText) {
        return fromText;
      }
    }

    // Fallback: count rendered diff rows. Misses rows behind "Load diff"
    // buttons on oversized diffs - acceptable, treated as counted-but-unexpanded.
    const added = container.querySelectorAll('.blob-code-addition').length;
    const removed = container.querySelectorAll('.blob-code-deletion').length;
    return added + removed > 0 ? {added, removed} : null;
  },
};

/** The heading a React-view file is titled by through aria-labelledby. */
function fileTitle(container: Element): Element | null {
  for (const id of (container.getAttribute('aria-labelledby') ?? '').split(/\s+/)) {
    const title = id ? document.getElementById(id) : null;
    if (title && container.contains(title)) return title;
  }
  return null;
}

/**
 * The header row around a file's title: the outermost box holding the
 * title but not the diff table, then unwrapped of single-child wrappers so
 * the controls land in the row itself.
 */
function headerAround(title: Element, container: Element): Element {
  let header = title;
  while (
    header.parentElement &&
    header.parentElement !== container &&
    !header.parentElement.querySelector('table')
  )
    header = header.parentElement;
  while (header.childElementCount === 1 && header.firstElementChild!.contains(title)) {
    if (header.firstElementChild === title) break;
    header = header.firstElementChild!;
  }
  return header;
}

const reactAdapter: ViewAdapter = {
  name: 'react',
  containerSelector: 'div[id^="diff-"]',
  // Everything here is found by what GitHub has to keep stable - the file's
  // anchor id, its accessible title, the table's label and screen-reader
  // stats - not by hashed class names, which change whenever GitHub
  // rebuilds (DiffFileHeader-module__diff-file-header became
  // diff-file-header__CV6GPS). Class fragments are only a last fallback.
  headerSelector:
    '[data-diff-header-wrapper], table[aria-label^="Diff for: "], [class*="diff-file-header"]',
  getPath(container) {
    // The path is the file's accessible title, polluted with invisible bidi
    // marks. Renames render as "old → new" - the new path is what matters.
    const nameElement = fileTitle(container) ?? container.querySelector('h3[class*="file-name"]');
    const text = nameElement?.textContent?.replaceAll(/[\u200E\u200F]/gu, '').trim();
    if (text) {
      const arrow = text.lastIndexOf('→');
      return (arrow === -1 ? text : text.slice(arrow + 1).trim()) || null;
    }

    // The diff table names its file without relying on any class name.
    const table = container.querySelector('table[aria-label^="Diff for: "]');
    const fromTable = table?.getAttribute('aria-label')?.slice('Diff for: '.length).trim();
    if (fromTable) return fromTable;

    // Loading skeletons have no header yet; the path sits in the
    // container's own aria-label as "Loading <path>" (seen live). Accept a
    // bare path label too - cheap insurance against header class renames.
    const label = container.getAttribute('aria-label')?.trim() ?? '';
    const path = label.startsWith('Loading ') ? label.slice('Loading '.length).trim() : label;
    return label.startsWith('Loading ') ? path || null : path.includes('/') ? path : null;
  },
  getHeader(container) {
    const title = fileTitle(container);
    if (title) return headerAround(title, container);
    return (
      container.querySelector('[data-diff-header-wrapper] > *') ??
      container.querySelector('[class*="diff-file-header"]')
    );
  },
  getChangedLines(container) {
    // The header carries per-file stats as "+58" / "−22" leaf elements
    // (aria-label text in some variants). Trust those first.
    const header = this.getHeader(container);
    if (header) {
      const labeled = header.querySelector(
        '[aria-label*="addition"], [title*="addition"], [aria-label*="deletion"], [title*="deletion"]',
      );
      const fromLabel = parseDiffstatText(
        labeled?.getAttribute('aria-label') ?? labeled?.getAttribute('title') ?? '',
      );
      if (fromLabel) {
        return fromLabel;
      }

      // Screen-reader text: "Lines changed: 77 additions & 0 deletions".
      const fromText = parseDiffstatText(header.textContent ?? '');
      if (fromText) {
        return fromText;
      }

      const fromStats = parsePlusMinusStats(header);
      if (fromStats) {
        return fromStats;
      }
    }

    // Last resort: count rendered rows. Row-level classes are hashed and
    // undocumented; returns null when rows aren't distinguishable, and the
    // caller keeps the file counted but marks its line statistics as unavailable.
    const rows = container.querySelectorAll('tr.diff-line-row');
    if (rows.length === 0) {
      return null;
    }

    let added = 0;
    let removed = 0;
    for (const row of rows) {
      const classNames = `${row.className} ${row.firstElementChild?.className ?? ''}`;
      if (/addition/i.test(classNames)) {
        added++;
      } else if (/deletion/i.test(classNames)) {
        removed++;
      }
    }

    return added + removed > 0 ? {added, removed} : null;
  },
};

export const adapters: ViewAdapter[] = [classicAdapter, reactAdapter];

export const containerSelector = adapters.map((adapter) => adapter.containerSelector).join(', ');

export const headerSelector = adapters.map((adapter) => adapter.headerSelector).join(', ');

export function adapterFor(container: Element): ViewAdapter | undefined {
  return adapters.find((adapter) => container.matches(adapter.containerSelector));
}

/** Virtualizer roots: the list itself, never one file's wrapper. */
const VIRTUAL_LIST_SELECTOR = '[data-virtualizer], [data-virtuoso-scroller]';

/**
 * An element the layout places by coordinates (absolute/fixed or a
 * transform), as virtualizers do with their slots. Removing a file from a
 * slot like this leaves a hole, because the slot keeps its measured height.
 */
function isPositionedSlot(element: Element): boolean {
  const style = getComputedStyle(element);
  return (
    style.position === 'absolute' ||
    style.position === 'fixed' ||
    (style.transform !== '' && style.transform !== 'none')
  );
}

/**
 * Whether a React-view file sits in a slot a virtualizer positions by
 * coordinates. GitHub's files list carries virtualizer markers (`data-index`,
 * "Virtualized" classes) even when its slots are in normal flow, and those
 * files can be hidden like any other; only coordinate-placed slots can't.
 */
export function inPositionedSlot(container: Element): boolean {
  let element = container.parentElement;
  for (
    let hops = 0;
    element && hops < 6 && element.tagName !== 'MAIN' && element !== document.body;
    hops++
  ) {
    if (isPositionedSlot(element)) return true;
    if (element.matches(VIRTUAL_LIST_SELECTOR)) return false;
    element = element.parentElement;
  }
  return false;
}

/**
 * The outermost element that belongs to exactly one PR file. In the React
 * view the `div[id^="diff-"]` container can sit inside a per-file row/slot
 * that keeps its own height, so hiding the container alone leaves scroll
 * space behind - state classes go on this wrapper too.
 *
 * The climb is deliberately paranoid: it stops at anything holding more
 * than one file container, anything holding the file tree or the toolbar,
 * anything with many children (a virtualized list's slots), after 4 hops,
 * and never reaches <main>. Worst case it returns the container itself,
 * which is the pre-fix behaviour.
 */
export function outerFileWrapper(container: Element): Element {
  let outer = container;
  let parent = container.parentElement;
  for (
    let hops = 0;
    parent && hops < 4 && parent.tagName !== 'MAIN' && parent !== document.body;
    hops++
  ) {
    // Positioned virtualizer slots own their height/position even with one
    // mounted file; a flow-layout slot shrinks with its file, so it can hide.
    if (parent.matches(VIRTUAL_LIST_SELECTOR) || isPositionedSlot(parent)) break;
    // A list of file slots is not a per-file wrapper. Check before scanning
    // its descendants so a large PR does not trigger a full scan per file.
    if (parent.childElementCount > 4) {
      break;
    }
    if (parent.querySelectorAll(containerSelector).length !== 1) {
      break;
    }

    if (parent.querySelector('li.js-tree-node, li[class*="file-tree-row"]')) {
      break;
    }

    if (parent.querySelector('section[class*="PullRequestFilesToolbar"], .pr-toolbar')) {
      break;
    }

    outer = parent;
    parent = parent.parentElement;
  }

  return outer;
}

/**
 * Real React-view file containers are `div#diff-<md5 hex of the file path>`.
 * The `div[id^="diff-"]` prefix also matches page chrome - seen live:
 * `#diff-file-tree-filter` (the tree search box) and
 * `#diff-comparison-viewer-container` (the whole viewer wrapper). Neither is
 * a file, so the react adapter only claims hex-id'd elements.
 */
const REACT_FILE_ID = /^diff-[0-9a-f]{8,}$/;

/**
 * Plausibility guard against selector over-match (the React container
 * selector is prefix-based and could one day match a page-level wrapper).
 * A real file container is never <body>/<main> and never nests another
 * file container inside itself.
 */
export function isFileContainer(element: Element): boolean {
  if (
    element === document.body ||
    element === document.documentElement ||
    element.tagName === 'MAIN'
  ) {
    return false;
  }

  if (element.matches(reactAdapter.containerSelector) && !REACT_FILE_ID.test(element.id)) {
    return false;
  }

  // Classic `div.file` boxes without `js-file` share the hex id but aren't PR file rows (seen live).
  if (element.matches('div.file:not(.js-file)')) {
    return false;
  }

  if (!adapterFor(element)) {
    return false;
  }

  return !element.querySelector(containerSelector);
}
