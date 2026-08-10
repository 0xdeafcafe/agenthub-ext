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
    // aria-label/title/text depending on the page version — try all of it.
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
    // buttons on oversized diffs — acceptable, treated as counted-but-unexpanded.
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
    // render as "old → new" — the new path is what matters.
    const nameElement =
      container.querySelector('h3[class^="DiffFileHeader-module__file-name"] code') ??
      queryByClassPrefix(container, 'DiffFileHeader-module__file-name');
    const text = nameElement?.textContent?.replaceAll(/[\u200E\u200F]/gu, '').trim();
    if (!text) {
      return null;
    }

    const arrow = text.lastIndexOf('→');
    return (arrow === -1 ? text : text.slice(arrow + 1).trim()) || null;
  },
  getHeader(container) {
    return queryByClassPrefix(container, 'DiffFileHeader-module__diff-file-header');
  },
  getChangedLines(container) {
    // Row-level classes are hashed and undocumented; this is best-effort
    // and returns null when rows aren't distinguishable.
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
 * Plausibility guard against selector over-match (the React container
 * selector is prefix-based and could one day match a page-level wrapper).
 * A real file container is never <body>/<main> and never nests another
 * file container inside itself.
 */
export function isFileContainer(element: Element): boolean {
  if (element === document.body || element === document.documentElement || element.tagName === 'MAIN') {
    return false;
  }

  if (!adapterFor(element)) {
    return false;
  }

  return !element.querySelector(containerSelector);
}
