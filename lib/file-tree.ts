import type {DisplayState} from './state';

/**
 * File-tree/sidebar sync: dims rows whose file is in a collapsed/hidden
 * category, fades folders whose contents are entirely faded, and closes a
 * folder's disclosure once when it first goes fully faded.
 *
 * Rows are classified by their full path when the tree carries one (the
 * classic view's hidden `data-filterable-item-text` span) - that works from
 * first paint, even for files the diff hasn't mounted yet. Rows without a
 * path fall back to matching the diff container's `#diff-<hash>` anchor,
 * and rows with neither count as unknown, which the rollup treats as
 * visible: a folder fading late beats a folder faded by mistake.
 *
 * Rows are dimmed in place, never removed (removal would fight GitHub's
 * tree filtering).
 */

// Classic view: li.ActionList-item.js-tree-node; React view: li[class*="file-tree-row"]
export const TREE_ROW_SELECTOR = 'li.js-tree-node, li[class*="file-tree-row"]';

/** The linked file container's id (`diff-<hash>`), or null for directory rows. */
export function treeRowContainerId(row: Element): string | null {
  const anchor = row.querySelector('a[href^="#diff-"]');
  return anchor?.getAttribute('href')?.slice(1) ?? null;
}

/** The row's full file path from the hidden filter-text span, when the tree carries one. */
export function treeRowPath(row: Element): string | null {
  const el = row.querySelector(':scope > [data-filterable-item-text]');
  return el?.textContent?.trim() || null;
}

/** Folder rows: explicit directory marker, or a row with nested child rows. */
export function isFolderRow(row: Element): boolean {
  return (
    row.getAttribute('data-tree-entry-type') === 'directory' ||
    row.querySelector(':scope > ul li') !== null
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

/** The folder row's own disclosure control - the thing a user would click. */
export function folderDisclosure(row: Element): HTMLElement | null {
  return row.querySelector(':scope > [aria-expanded]');
}

/**
 * A folder identity that survives GitHub re-creating row elements: the
 * label chain from the tree root, e.g. "packages/react-dom/src". Null when
 * no labels are readable (better to skip auto-collapse than to misfire).
 */
export function folderKey(row: Element): string | null {
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
  if (disclosure?.getAttribute('aria-expanded') !== 'true') {
    return false;
  }

  autoCollapsed.add(key);
  disclosure.click();
  return true;
}
