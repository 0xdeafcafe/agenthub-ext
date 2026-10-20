import {CommentScanner} from './comments';
import {containerSelector} from './views';

/**
 * How comment-only lines show in the rendered diff:
 * - `show`: as GitHub renders them
 * - `fold`: a run longer than FOLD_THRESHOLD lines keeps its first and last
 *   line, with the middle folded behind one "N comment lines" row
 * - `hide`: every comment-only line is hidden
 */
export type CommentMode = 'show' | 'fold' | 'hide';
export const COMMENT_MODES: CommentMode[] = ['show', 'fold', 'hide'];
export const FOLD_THRESHOLD = 5;

export function isCommentMode(value: unknown): value is CommentMode {
  return COMMENT_MODES.includes(value as CommentMode);
}

type Side = 'old' | 'new' | 'both';
interface CodeCell {
  side: Side;
  text: string;
}
/** A diff line row, or a boundary (hunk header, expander, inline comment) that ends a run. */
type DiffRow = {row: HTMLTableRowElement; cells: CodeCell[]} | 'break';

const ROW_CLASS = 'prix-comment-line';
const FOLD_CLASS = 'prix-comment-fold';
/** Classic code cells, then the React view's text cells. */
const CODE_CELL = ':scope > td.blob-code, :scope > td[class*="diff-text-cell"]';

function sideOf(cell: Element, index: number, count: number): Side {
  const kind = `${cell.className} ${cell.parentElement?.className ?? ''}`;
  if (/addition/i.test(kind)) return 'new';
  if (/deletion/i.test(kind)) return 'old';
  // Split view: a context row shows the old side on the left, new on the right.
  if (count === 2) return index === 0 ? 'old' : 'new';
  return 'both';
}

function cellText(cell: Element): string {
  const inner = cell.querySelector('.blob-code-inner, [class*="diff-text-inner"]') ?? cell;
  return (inner.textContent ?? '').replace(/\n$/, '');
}

function readRows(container: Element): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const row of container.querySelectorAll<HTMLTableRowElement>('table tr')) {
    if (row.classList.contains(FOLD_CLASS)) continue;
    if (row.closest(containerSelector) !== container) continue;
    const cells = [...row.querySelectorAll(CODE_CELL)].filter(
      (cell) => !/empty/.test(cell.className),
    );
    if (cells.length === 0) {
      // Header rows hold only <th>; everything else is a boundary.
      if (row.querySelector(':scope > td')) rows.push('break');
      continue;
    }
    if (cells.some((cell) => /hunk/.test(cell.className) || cellText(cell).startsWith('@@ '))) {
      rows.push('break');
      continue;
    }
    rows.push({
      row,
      cells: cells.map((cell, index) => ({
        side: sideOf(cell, index, cells.length),
        text: cellText(cell),
      })),
    });
  }
  return rows;
}

/**
 * Runs of consecutive comment-only rows. Old and new sides keep separate
 * lexer state, reset at each hunk like the full-diff inventory, so a block
 * comment opened above a hunk can't leak into the next one.
 */
export function commentRuns(container: Element, path: string): HTMLTableRowElement[][] {
  const runs: HTMLTableRowElement[][] = [];
  let run: HTMLTableRowElement[] = [];
  let oldScanner = new CommentScanner(path);
  let newScanner = new CommentScanner(path);
  const end = (): void => {
    if (run.length) runs.push(run);
    run = [];
  };
  for (const entry of readRows(container)) {
    if (entry === 'break') {
      end();
      oldScanner = new CommentScanner(path);
      newScanner = new CommentScanner(path);
      continue;
    }
    let comment = false;
    let code = false;
    for (const cell of entry.cells) {
      const isComment =
        cell.side === 'both'
          ? [oldScanner.scan(cell.text), newScanner.scan(cell.text)][1]
          : (cell.side === 'old' ? oldScanner : newScanner).scan(cell.text);
      if (isComment) comment = true;
      else code = true;
    }
    if (comment && !code) run.push(entry.row);
    else end();
  }
  end();
  return runs;
}

function columnCount(row: HTMLTableRowElement): number {
  return [...row.cells].reduce((sum, cell) => sum + (cell.colSpan || 1), 0);
}

function foldRow(hidden: number, columns: number, expand: () => void): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.className = FOLD_CLASS;
  const cell = document.createElement('td');
  cell.colSpan = columns;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `⋯ ${hidden.toLocaleString('en-US')} more comment ${hidden === 1 ? 'line' : 'lines'}`;
  button.title = 'Show the squashed comment lines';
  button.addEventListener('click', expand);
  cell.append(button);
  row.append(cell);
  return row;
}

/** Applies a comment mode to one file's rendered rows; safe to call repeatedly. */
export class CommentLines {
  /** Runs the reviewer unfolded, keyed by their first row. */
  #expanded = new WeakSet<Element>();
  #touched = new Set<Element>();
  /** What each file was last folded from, so unchanged files skip the rescan. */
  #applied = new WeakMap<Element, string>();
  #version = 0;

  apply(container: Element, path: string, mode: CommentMode, onChange: () => void): void {
    const rows = container.getElementsByTagName('tr').length;
    const folds = container.getElementsByClassName(FOLD_CLASS).length;
    const signature = `${mode}:${path}:${rows - folds}:${this.#version}`;
    if (this.#applied.get(container) === signature) return;
    this.#applied.set(container, signature);
    this.clear(container);
    if (mode === 'show') return;
    this.#touched.add(container);
    for (const run of commentRuns(container, path)) {
      if (mode === 'hide') {
        for (const row of run) row.classList.add(ROW_CLASS);
        continue;
      }
      if (run.length <= FOLD_THRESHOLD || this.#expanded.has(run[0])) continue;
      const middle = run.slice(1, -1);
      for (const row of middle) row.classList.add(ROW_CLASS);
      run[0].after(
        foldRow(middle.length, columnCount(run[0]), () => {
          this.#expanded.add(run[0]);
          this.#version++;
          onChange();
        }),
      );
    }
  }

  clear(container: Element): void {
    if (!this.#touched.delete(container)) return;
    for (const row of container.querySelectorAll(`.${FOLD_CLASS}`)) row.remove();
    for (const row of container.querySelectorAll(`.${ROW_CLASS}`)) row.classList.remove(ROW_CLASS);
  }

  clearAll(): void {
    for (const container of this.#touched) this.clear(container);
    this.#applied = new WeakMap();
  }
}

/** True when a mutation only added or removed our own fold rows. */
export function isOwnRowMutation(record: MutationRecord): boolean {
  const nodes = [...record.addedNodes, ...record.removedNodes];
  return (
    nodes.length > 0 &&
    nodes.every((node) => node instanceof Element && node.classList.contains(FOLD_CLASS))
  );
}
