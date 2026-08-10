import {h} from 'dom-chef';
import type {DisplayState} from './state';
import type {ImpactMap} from './impact-report';

export interface CategoryCount {
  files: number;
  added: number;
  removed: number;
  reviewed: number;
}

export interface BarHandlers {
  onCycle: (category: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onCopy: () => void;
  onJump: (direction: 1 | -1) => void;
}

// Primer-safe emphasis colours; hex fallbacks match Primer's light theme.
const PALETTE = [
  'var(--bgColor-accent-emphasis, #0969da)',
  'var(--bgColor-success-emphasis, #1a7f37)',
  'var(--bgColor-attention-emphasis, #9a6700)',
  'var(--bgColor-danger-emphasis, #cf222e)',
  'var(--bgColor-done-emphasis, #8250df)',
  'var(--bgColor-severe-emphasis, #bc4c00)',
];
const CODE_COLOR = 'var(--bgColor-neutral-emphasis, #6e7781)';

// Octicon paths (unfold, fold, chevron-up, chevron-down, copy) - 16px viewBox
const ICONS = {
  unfold:
    'm8.177.677 2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25a.75.75 0 0 1-1.5 0V4H5.104a.25.25 0 0 1-.177-.427L7.823.677a.25.25 0 0 1 .354 0ZM7.25 10.75a.75.75 0 0 1 1.5 0V12h2.146a.25.25 0 0 1 .177.427l-2.896 2.896a.25.25 0 0 1-.354 0l-2.896-2.896A.25.25 0 0 1 5.104 12H7.25v-1.25Zm-5-2a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 1 0 1.5h.5Z',
  fold:
    'M10.896 2H8.75V.75a.75.75 0 0 0-1.5 0V2H5.104a.25.25 0 0 0-.177.427l2.896 2.896a.25.25 0 0 0 .354 0l2.896-2.896A.25.25 0 0 0 10.896 2ZM8.75 15.25a.75.75 0 0 1-1.5 0V14H5.104a.25.25 0 0 1-.177-.427l2.896-2.896a.25.25 0 0 1 .354 0l2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25Zm-6.5-6.5a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 1 0 1.5h.5Z',
  up: 'M3.22 10.53a.749.749 0 0 1 0-1.06l4.25-4.25a.749.749 0 0 1 1.06 0l4.25 4.25a.749.749 0 1 1-1.06 1.06L8 6.811 4.28 10.53a.749.749 0 0 1-1.06 0Z',
  down: 'M12.78 5.22a.749.749 0 0 1 0-1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z',
  copy:
    'M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z',
} as const;

function octicon(pathData: string): SVGElement {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={pathData} />
    </svg>
  ) as unknown as SVGElement;
}

function controlButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = (
    <button type="button" className="prix-control" title={title} aria-label={title}>
      {octicon(icon)}
    </button>
  ) as unknown as HTMLButtonElement;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Where to mount the bar, given the element it should sit in front of.
 * Never returns a flex/grid parent: inserting into GitHub's row layout
 * makes the bar a layout column of its own (seen live on the React files
 * view - bar column, then tree, then diff, with dead space under the bar).
 * Walks up to the nearest block-flow ancestor and places the bar in front of
 * the whole row instead. Null when nothing block-level is found nearby;
 * better no bar than a mangled page.
 */
export function findBarPlacement(anchor: Element): {parent: Element; before: Element | null} | null {
  let child: Element = anchor;
  let parent = anchor.parentElement;
  for (let hops = 0; parent && hops < 8 && parent.tagName !== 'MAIN' && parent !== document.body; hops++) {
    const {display} = getComputedStyle(parent);
    if (!display.includes('flex') && !display.includes('grid')) {
      return {parent, before: child};
    }

    child = parent;
    parent = parent.parentElement;
  }

  return null;
}

/**
 * Slim stacked bar + legend. `update` only mutates text/width/state of
 * existing nodes - it runs on every lazily-mounted file container.
 */
export class ImpactBar {
  readonly element: HTMLElement;
  readonly #categories: string[];
  readonly #segments = new Map<string, HTMLElement>();
  readonly #chips = new Map<string, HTMLElement>();
  readonly #chipMeta = new Map<string, HTMLSpanElement>();
  readonly #totals: HTMLSpanElement;
  readonly #chartLine: HTMLElement;

  constructor(categories: string[], handlers: BarHandlers) {
    this.#categories = categories;

    this.#totals = <span className="prix-totals" /> as unknown as HTMLSpanElement;
    this.#chartLine = (<div className="prix-chart" hidden />) as unknown as HTMLElement;

    this.element = (
      <div className="prix-bar" id="prix-bar">
        <div className="prix-bar-track">
          {categories.map((name, index) => {
            const segment = (
              <div className="prix-segment" data-category={name} />
            ) as HTMLElement;
            segment.style.backgroundColor =
              name === 'code' ? CODE_COLOR : PALETTE[index % PALETTE.length];
            this.#segments.set(name, segment);
            return segment;
          })}
        </div>
        <div className="prix-bar-legend">
          {categories.map((name, index) => {
            const meta = <span className="prix-chip-meta" /> as unknown as HTMLSpanElement;
            const dot = (<span className="prix-dot" />) as HTMLElement;
            dot.style.backgroundColor = name === 'code' ? CODE_COLOR : PALETTE[index % PALETTE.length];
            const chip = (
              <button type="button" className="prix-chip" data-category={name} data-state="visible">
                {dot}
                <span className="prix-chip-name">{name}</span>
                {meta}
              </button>
            ) as unknown as HTMLElement;
            chip.addEventListener('click', () => {
              handlers.onCycle(name);
            });
            this.#chips.set(name, chip);
            this.#chipMeta.set(name, meta);
            return chip;
          })}
          <span className="prix-spacer" />
          {this.#totals}
          {controlButton(ICONS.up, 'Previous visible file (Shift+K)', () => {
            handlers.onJump(-1);
          })}
          {controlButton(ICONS.down, 'Next visible file (Shift+J)', () => {
            handlers.onJump(1);
          })}
          {controlButton(ICONS.unfold, 'Expand all categories', handlers.onExpandAll)}
          {controlButton(ICONS.fold, 'Collapse all categories', handlers.onCollapseAll)}
          {controlButton(ICONS.copy, 'Copy impact report as markdown', handlers.onCopy)}
        </div>
        {this.#chartLine}
      </div>
    ) as unknown as HTMLElement;
  }

  /** Language "PR Impact Map" summary line, shown under the legend when the PR has one. */
  setImpactMap(map: ImpactMap | null): void {
    if (!map) {
      this.#chartLine.hidden = true;
      return;
    }

    this.#chartLine.hidden = false;
    this.#chartLine.textContent = `Impact Map: ${map.categories
      .map(category => `${category.name} ${category.share}%`)
      .join(' · ')}`;
    this.#chartLine.title = `Posted by the Language bot on this PR (${map.totalFiles} files, +${map.totalAdded} / -${map.totalRemoved})`;
  }

  update(counts: ReadonlyMap<string, CategoryCount>, stateOf: (category: string) => DisplayState): void {
    let totalLines = 0;
    let totalFiles = 0;
    let totalReviewed = 0;
    for (const name of this.#categories) {
      const count = counts.get(name) ?? {files: 0, added: 0, removed: 0, reviewed: 0};
      totalLines += count.added + count.removed;
      totalFiles += count.files;
      totalReviewed += count.reviewed;
    }

    // Line counts drive segment widths/percentages; when nothing was
    // parseable (unmounted/virtualized rows) fall back to file counts.
    const useLines = totalLines > 0;
    const total = useLines ? totalLines : totalFiles;

    for (const name of this.#categories) {
      const count = counts.get(name) ?? {files: 0, added: 0, removed: 0, reviewed: 0};
      const lines = count.added + count.removed;
      const share = total > 0 ? (useLines ? lines : count.files) / total : 0;
      const state = stateOf(name);

      const segment = this.#segments.get(name)!;
      segment.style.flexGrow = String(count.files > 0 ? share : 0);
      segment.hidden = count.files === 0;

      const filesText = `${count.files} ${count.files === 1 ? 'file' : 'files'}`;
      const linesText = lines > 0 ? ` · ${lines} lines` : '';
      const shareText = total > 0 && count.files > 0 ? ` · ${Math.round(share * 100)}%` : '';
      const reviewedText = count.reviewed > 0 ? ` · ${count.reviewed} of ${count.files} reviewed` : '';

      const chip = this.#chips.get(name)!;
      chip.dataset.state = state;
      chip.hidden = count.files === 0;
      chip.title = `${name} - click to cycle visible → collapsed → hidden${reviewedText ? `\n${count.reviewed} of ${count.files} reviewed` : ''}`;
      this.#chipMeta.get(name)!.textContent = `${filesText}${linesText}${shareText}`;
      segment.title = `${name} - ${filesText}${linesText}${shareText}${reviewedText}`;
    }

    this.#totals.textContent =
      `${totalFiles} ${totalFiles === 1 ? 'file' : 'files'} · ${totalLines} lines` +
      (totalReviewed > 0 ? ` · ${totalReviewed} reviewed` : '');
  }
}
