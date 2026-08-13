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

/** Prefix-match first, contains-match as fallback (hashed class may not be the first class). */
function queryByClassPrefix(root: ParentNode, prefix: string): Element | null {
  return root.querySelector(`[class^="${prefix}"], [class*="${prefix}"]`);
}

function parseDiffstatText(text: string): ChangedLines | null {
  const added = /(\d+)\s+additions?/.exec(text);
  const removed = /(\d+)\s+deletions?/.exec(text);
  if (added ?? removed) {
    return {
      added: added ? Number(added[1]) : 0,
      removed: removed ? Number(removed[1]) : 0,
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
      const labeled = header.querySelector('[aria-label*="addition"], [title*="addition"]');
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

const reactAdapter: ViewAdapter = {
  name: 'react',
  containerSelector: 'div[id^="diff-"]',
  headerSelector:
    '[class^="DiffFileHeader-module__diff-file-header"], [class*="DiffFileHeader-module__diff-file-header"]',
  getPath(container) {
    // No data-path attribute in the React view; the path lives in the
    // header's <h3> and is polluted with invisible bidi marks. Renames
    // render as "old → new" - the new path is what matters.
    const nameElement =
      container.querySelector('h3[class^="DiffFileHeader-module__file-name"] code') ??
      queryByClassPrefix(container, 'DiffFileHeader-module__file-name');
    const text = nameElement?.textContent?.replaceAll(/[\u200E\u200F]/gu, '').trim();
    if (text) {
      const arrow = text.lastIndexOf('→');
      return (arrow === -1 ? text : text.slice(arrow + 1).trim()) || null;
    }

    // Loading skeletons have no header yet; the path sits in the
    // container's own aria-label as "Loading <path>" (seen live). Accept a
    // bare path label too - cheap insurance against header class renames.
    const label = container.getAttribute('aria-label')?.trim() ?? '';
    const path = label.startsWith('Loading ') ? label.slice('Loading '.length).trim() : label;
    return path.includes('/') ? path : null;
  },
  getHeader(container) {
    return queryByClassPrefix(container, 'DiffFileHeader-module__diff-file-header');
  },
  getChangedLines(container) {
    // The header carries per-file stats as "+58" / "−22" leaf elements
    // (aria-label text in some variants). Trust those first.
    const header = this.getHeader(container);
    if (header) {
      const labeled = header.querySelector('[aria-label*="addition"], [title*="addition"]');
      const fromLabel = parseDiffstatText(
        labeled?.getAttribute('aria-label') ?? labeled?.getAttribute('title') ?? '',
      );
      if (fromLabel) {
        return fromLabel;
      }

      const fromStats = parsePlusMinusStats(header);
      if (fromStats) {
        return fromStats;
      }
    }

    // Last resort: count rendered rows. Row-level classes are hashed and
    // undocumented; returns null when rows aren't distinguishable, and the
    // caller treats the file as counted-but-unmeasured (0 lines, never poisoned).
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

export const containerSelector = adapters.map(adapter => adapter.containerSelector).join(', ');

export const headerSelector = adapters.map(adapter => adapter.headerSelector).join(', ');

export function adapterFor(container: Element): ViewAdapter | undefined {
  return adapters.find(adapter => container.matches(adapter.containerSelector));
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
  for (let hops = 0; parent && hops < 4 && parent.tagName !== 'MAIN' && parent !== document.body; hops++) {
    if (parent.querySelectorAll(containerSelector).length !== 1) {
      break;
    }

    if (parent.querySelector('li.js-tree-node, li[class*="file-tree-row"]')) {
      break;
    }

    if (parent.querySelector('section[class*="PullRequestFilesToolbar"], .pr-toolbar')) {
      break;
    }

    if (parent.childElementCount > 4) {
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
  if (element === document.body || element === document.documentElement || element.tagName === 'MAIN') {
    return false;
  }

  if (element.matches(reactAdapter.containerSelector) && !REACT_FILE_ID.test(element.id)) {
    return false;
  }

  if (!adapterFor(element)) {
    return false;
  }

  return !element.querySelector(containerSelector);
}
