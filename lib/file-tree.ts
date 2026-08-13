import type {DisplayState} from './state';

/**
 * File-tree/sidebar sync: dims rows whose file is in a collapsed/hidden
 * category, fades folders whose contents are entirely faded, and closes a
 * folder's disclosure once when it first goes fully faded.
 *
 * Rows are classified by their full path when the tree carries one - the
 * classic view's hidden `data-filterable-item-text` span, or the React
 * TreeView's row id, which IS the full path (seen live). That works from
 * first paint, even for files the diff hasn't mounted yet. Rows without a
 * path fall back to matching the diff container's `#diff-<hash>` anchor,
 * and rows with neither count as unknown, which the rollup treats as
 * visible: a folder fading late beats a folder faded by mistake.
 *
 * Folder rollups prefer path-prefix matching over DOM nesting: the React
 * TreeView gives every row a full-path id, while its folder rows don't
 * reliably nest child rows. The classic nested `<ul>` rollup is the
 * fallback for trees without paths.
 *
 * Rows are dimmed in place, never removed (removal would fight GitHub's
 * tree filtering).
 */

// Classic view: li.ActionList-item.js-tree-node; React view: Primer TreeView
// items (li[role="treeitem"], DiffFileTree-module__file-tree-row__* classes).
export const TREE_ROW_SELECTOR = 'li.js-tree-node, li[class*="file-tree-row"], li[role="treeitem"]';

/** The linked file container's id (`diff-<hash>`), or null for directory rows. */
export function treeRowContainerId(row: Element): string | null {
  const anchor = row.querySelector('a[href^="#diff-"]');
  return anchor?.getAttribute('href')?.slice(1) ?? null;
}

/** The row's full file path, when the tree carries one. */
export function treeRowPath(row: Element): string | null {
  // Classic view: the hidden filter-text span carries the full path.
  const filterPath = row.querySelector(':scope > [data-filterable-item-text]')?.textContent?.trim();
  if (filterPath) {
    return filterPath;
  }

  // React TreeView: the row's own id is the full path (seen live).
  if (row.matches('li[class*="file-tree-row"]') && row.id) {
    return row.id;
  }

  return null;
}

/** Folder rows: explicit directory marker, an expand/collapse state (self or child), or nested child rows. */
export function isFolderRow(row: Element): boolean {
  return (
    row.getAttribute('data-tree-entry-type') === 'directory' ||
    row.hasAttribute('aria-expanded') ||
    row.querySelector(':scope > [aria-expanded], :scope > ul li') !== null
  );
}

/**
 * Rollup over the states of a folder's classified descendant files.
 * Conservative by construction: empty folders and any unknown (not yet
 * mounted/classified) file keep the folder normal.
 */
export function aggregateFolderState(states: Array<DisplayState | null>): DisplayState {
  if (states.length === 0 || states.includes(null)) {
    return 'visible';
  }

  if (states.every(state => state === 'hidden')) {
    return 'hidden';
  }

  if (states.every(state => state !== 'visible')) {
    return 'collapsed';
  }

  return 'visible';
}

/** The states of the classified file rows under a folder row (folders themselves don't count). */
export function folderFileStates(
  row: Element,
  stateOfRow: (fileRow: Element) => DisplayState | null,
): Array<DisplayState | null> {
  const states: Array<DisplayState | null> = [];
  for (const child of row.querySelectorAll(TREE_ROW_SELECTOR)) {
    if (!isFolderRow(child)) {
      states.push(stateOfRow(child));
    }
  }

  return states;
}

/** Folders get the same opacity classes as files (CSS scopes the dim to the row's own label) and never a badge. */
export function applyFolderState(row: Element, state: DisplayState): void {
  row.classList.toggle('prix-tree-collapsed', state === 'collapsed');
  row.classList.toggle('prix-tree-hidden', state === 'hidden');
}

export function applyTreeRowState(row: Element, category: string, state: DisplayState): void {
  row.classList.toggle('prix-tree-collapsed', state === 'collapsed');
  row.classList.toggle('prix-tree-hidden', state === 'hidden');

  // Hidden rows carry the category badge so the dimming is self-explanatory
  const existing = row.querySelector(':scope > .prix-tree-badge, a > .prix-tree-badge');
  if (state === 'hidden' && !existing) {
    const badge = document.createElement('span');
    badge.className = 'prix-tree-badge';
    badge.textContent = category;
    (row.querySelector('a[href^="#diff-"]') ?? row).append(badge);
  } else if (state !== 'hidden' && existing) {
    existing.remove();
  }
}

/**
 * States of known files under a folder path, by prefix match - for trees
 * whose rows carry full paths (React TreeView row ids), where folder rows
 * don't reliably nest their children in the DOM.
 */
export function folderStatesByPath(folderPath: string, fileStates: ReadonlyMap<string, DisplayState>): DisplayState[] {
  const prefix = `${folderPath}/`;
  const states: DisplayState[] = [];
  for (const [path, state] of fileStates) {
    if (path.startsWith(prefix)) {
      states.push(state);
    }
  }

  return states;
}

/**
 * A folder's open state and the thing a user would click to toggle it.
 * Classic view: one child element carries both (the ActionList button).
 * React TreeView: aria-expanded lives on the row itself, and the click
 * target is its content child.
 */
export function folderDisclosure(row: Element): {stateHolder: Element; toggle: HTMLElement} | null {
  if (row.hasAttribute('aria-expanded')) {
    const content = row.querySelector<HTMLElement>(
      ':scope > [class*="TreeView-item-content"], :scope > .ActionList-content, :scope > a, :scope > button',
    );
    return {stateHolder: row, toggle: content ?? (row as HTMLElement)};
  }

  const child = row.querySelector<HTMLElement>(':scope > [aria-expanded]');
  return child ? {stateHolder: child, toggle: child} : null;
}

/**
 * A folder identity that survives GitHub re-creating row elements. React
 * TreeView rows carry the full path as their id; on the classic view it's
 * the label chain from the tree root, e.g. "packages/react-dom/src". Null
 * when neither is readable (better to skip auto-collapse than to misfire).
 */
export function folderKey(row: Element): string | null {
  if (row.id) {
    return row.id;
  }

  const labels: string[] = [];
  let current: Element | null = row;
  while (current) {
    const label = current
      .querySelector(':scope > [aria-expanded] .ActionList-item-label, :scope > [aria-expanded] [class*="label"]')
      ?.textContent?.trim();
    if (!label) {
      return null;
    }

    labels.unshift(label);
    current = current.parentElement?.closest(TREE_ROW_SELECTOR) ?? null;
  }

  return labels.join('/');
}

/**
 * Closes a faded folder's disclosure exactly once per folder per page, by
 * clicking the same control a user would (so GitHub's own tree state stays
 * consistent - never poke aria-expanded directly). Returns false without
 * acting when the folder is already closed, was auto-collapsed before, or
 * the user has ever toggled it themselves (tracked by the caller's sets).
 */
export function maybeAutoCollapseFolder(
  row: Element,
  state: DisplayState,
  userToggled: ReadonlySet<string>,
  autoCollapsed: Set<string>,
): boolean {
  if (state === 'visible') {
    return false;
  }

  const key = folderKey(row);
  if (!key || userToggled.has(key) || autoCollapsed.has(key)) {
    return false;
  }

  const disclosure = folderDisclosure(row);
  if (disclosure?.stateHolder.getAttribute('aria-expanded') !== 'true') {
    return false;
  }

  autoCollapsed.add(key);
  disclosure.toggle.click();
  return true;
}
