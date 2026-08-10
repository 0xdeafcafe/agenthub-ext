import type {DisplayState} from './state';

/**
 * File-tree/sidebar sync: dims tree rows whose file is in a collapsed/hidden
 * category. Rows are matched to file containers through their anchor href —
 * tree rows link to `#diff-<hash>`, the container's id in BOTH views — so no
 * path parsing is needed. Rows are dimmed in place, never removed (removal
 * would fight GitHub's own tree filtering).
 */

// Classic view: li.ActionList-item.js-tree-node; React view: li[class*="file-tree-row"]
export const TREE_ROW_SELECTOR = 'li.js-tree-node, li[class*="file-tree-row"]';

/** The linked file container's id (`diff-<hash>`), or null for directory rows. */
export function treeRowContainerId(row: Element): string | null {
  const anchor = row.querySelector('a[href^="#diff-"]');
  return anchor?.getAttribute('href')?.slice(1) ?? null;
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
