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
  onCopy: () => void | Promise<void>;
  onFocus?: () => void;
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
  fold: 'M10.896 2H8.75V.75a.75.75 0 0 0-1.5 0V2H5.104a.25.25 0 0 0-.177.427l2.896 2.896a.25.25 0 0 0 .354 0l2.896-2.896A.25.25 0 0 0 10.896 2ZM8.75 15.25a.75.75 0 0 1-1.5 0V14H5.104a.25.25 0 0 1-.177-.427l2.896-2.896a.25.25 0 0 1 .354 0l2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25Zm-6.5-6.5a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 1 0 1.5h.5Z',
  up: 'M3.22 10.53a.749.749 0 0 1 0-1.06l4.25-4.25a.749.749 0 0 1 1.06 0l4.25 4.25a.749.749 0 1 1-1.06 1.06L8 6.811 4.28 10.53a.749.749 0 0 1-1.06 0Z',
  down: 'M3.22 5.22a.75.75 0 0 1 1.06 0L8 8.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.28a.75.75 0 0 1 0-1.06Z',
  copy: 'M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z',
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

function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function setAttribute(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/** Matches the PR header's tab row (Conversation / Commits / Files changed). */
export const PR_HEADER_PROBE = 'a[href$="/commits"]';

/**
 * The header probe exists to keep the bar below the PR header while climbing,
 * not out of the anchor's own parent: inserting right before the anchor lands
 * exactly where the anchor is, and the anchor is the files region by
 * construction (the toolbar's next sibling or the first file container). Only
 * above that level does a probed parent need the insertion point to follow
 * the header in document order - seen live on langwatch#6894, where the whole
 * page content (header tabs + diff viewer) shares one block parent and the
 * correct mount is inside it, right above the viewer.
 */
function isBelowHeader(parent: Element, child: Element): boolean {
  const header = parent.querySelector(PR_HEADER_PROBE);
  if (!header) {
    return true; // no header at this level - an ordinary ancestor
  }

  return Boolean(header.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/**
 * Where to mount the bar, given the element it should sit in front of.
 * Never returns a flex/grid parent: inserting into GitHub's row layout
 * makes the bar a layout column of its own (seen live on the React files
 * view - bar column, then tree, then diff, with dead space under the bar).
 * And never climbs above the PR header: the climb stops at the first
 * ancestor whose header tab row does not precede our insertion point (see
 * isBelowHeader). If nothing block-flow was found below that point we
 * return null - better no bar than a mangled page.
 */
export function findBarPlacement(
  anchor: Element,
): {parent: Element; before: Element | null} | null {
  let child: Element = anchor;
  let parent = anchor.parentElement;
  let deepestBlock: {parent: Element; before: Element | null} | null = null;
  for (
    let hops = 0;
    parent && hops < 8 && parent.tagName !== 'MAIN' && parent !== document.body;
    hops++
  ) {
    if (hops > 0 && !isBelowHeader(parent, child)) {
      // Climbed into an ancestor whose PR header sits at or below our
      // insertion point - above the region the bar belongs to.
      return deepestBlock;
    }

    const {display} = getComputedStyle(parent);
    if (!display.includes('flex') && !display.includes('grid')) {
      deepestBlock ??= {parent, before: child};
      return deepestBlock;
    }

    child = parent;
    parent = parent.parentElement;
  }

  return deepestBlock;
}

/**
 * Last resort when findBarPlacement finds nothing block-flow: climb the same
 * ancestor chain looking for a level the bar can span instead of becoming a
 * column - full track span in grid, full-row basis in a wrapping flex row.
 * A nowrap flex row would squeeze its siblings to make room for us, so we
 * climb past it; a block parent needs no styling (findBarPlacement would
 * have found it, but harmless to accept here). Same bounds as before: never
 * at or above the PR header (isBelowHeader), never past <main>. Sets the
 * needed inline style on the bar element as a side effect.
 */
export function spanningBarPlacement(
  anchor: Element,
  barElement: HTMLElement,
): {parent: Element; before: Element | null} | null {
  let child: Element = anchor;
  let parent = anchor.parentElement;
  for (
    let hops = 0;
    parent && hops < 8 && parent.tagName !== 'MAIN' && parent !== document.body;
    hops++
  ) {
    if (hops > 0 && !isBelowHeader(parent, child)) {
      return null;
    }

    const {display, flexWrap} = getComputedStyle(parent);
    if (display.includes('grid')) {
      barElement.style.gridColumn = '1 / -1';
      return {parent, before: child};
    }

    if (display.includes('flex')) {
      if (flexWrap !== 'nowrap') {
        barElement.style.flex = '0 0 100%';
        return {parent, before: child};
      }
      // Nowrap flex: a full-basis child would squeeze its siblings - climb.
    } else {
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
  readonly #chipState = new Map<string, HTMLElement>();
  readonly #summary: HTMLElement;
  readonly #status: HTMLElement;
  readonly #progress: HTMLProgressElement;
  readonly #copy: HTMLButtonElement;
  readonly #focus: HTMLButtonElement;
  readonly #expand: HTMLButtonElement;
  #copyTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #totals: HTMLSpanElement;
  readonly #chartLine: HTMLElement;
  readonly #diffstat: HTMLElement;
  readonly #diffstatOrig: HTMLSpanElement;
  readonly #diffstatShownAdded: HTMLSpanElement;
  readonly #diffstatShownRemoved: HTMLSpanElement;
  readonly #diffstatBlocks: HTMLElement[];

  constructor(categories: string[], handlers: BarHandlers) {
    categories = [...new Set(categories)];
    this.#categories = categories;

    this.#totals = (<span className="prix-totals" />) as unknown as HTMLSpanElement;
    this.#chartLine = (<div className="prix-chart" hidden />) as unknown as HTMLElement;
    this.#summary = (<span className="prix-summary" />) as HTMLElement;
    this.#status = (
      <span className="prix-status" role="status" aria-live="polite" />
    ) as HTMLElement;
    this.#progress = (
      <progress className="prix-progress" max="100" value="0" aria-label="Files reviewed" />
    ) as unknown as HTMLProgressElement;
    this.#copy = controlButton(ICONS.copy, 'Copy impact report as markdown', () => {
      void this.#copyReport(handlers);
    });
    this.#copy.classList.add('prix-copy');
    const copyLabel = document.createElement('span');
    copyLabel.textContent = 'Copy report';
    this.#copy.append(copyLabel);
    this.#focus = (
      <button
        type="button"
        className="prix-preset"
        title="Expand code and collapse everything else"
      >
        Focus code
      </button>
    ) as unknown as HTMLButtonElement;
    this.#focus.addEventListener('click', () => handlers.onFocus?.());
    this.#focus.hidden = !handlers.onFocus;
    this.#expand = (
      <button type="button" className="prix-preset prix-control" aria-label="Expand all categories">
        Show all
      </button>
    ) as unknown as HTMLButtonElement;
    this.#expand.addEventListener('click', handlers.onExpandAll);

    // Condensed diffstat (GitHub's "+N −M" + proportion blocks, shrunk):
    // original totals vs the lines still visible under the current filters.
    // Only shown while filtering actually removes lines from view.
    this.#diffstatOrig = (<span className="prix-diffstat-orig" />) as unknown as HTMLSpanElement;
    this.#diffstatShownAdded = (
      <span className="prix-diffstat-added" />
    ) as unknown as HTMLSpanElement;
    this.#diffstatShownRemoved = (
      <span className="prix-diffstat-removed" />
    ) as unknown as HTMLSpanElement;
    this.#diffstatBlocks = Array.from(
      {length: 5},
      () => (<span className="prix-diffstat-block" />) as HTMLElement,
    );
    this.#diffstat = (
      <span className="prix-diffstat" hidden>
        {this.#diffstatOrig}
        <span className="prix-diffstat-arrow">→</span>
        {this.#diffstatShownAdded}
        {this.#diffstatShownRemoved}
        <span className="prix-diffstat-blocks">{this.#diffstatBlocks}</span>
      </span>
    ) as unknown as HTMLElement;

    this.element = (
      <section className="prix-bar" id="prix-bar" aria-label="PR Impact review controls">
        <div className="prix-bar-header">
          <div className="prix-heading">
            <span className="prix-brand" aria-hidden="true">
              {octicon(ICONS.unfold)}
            </span>
            <div>
              <span className="prix-bar-title">Review focus</span>
              {this.#totals}
            </div>
          </div>
          <div className="prix-actions">
            <div className="prix-presets" role="group" aria-label="Review presets">
              {this.#focus}
              {this.#expand}
            </div>
            {controlButton(ICONS.fold, 'Collapse all categories', handlers.onCollapseAll)}
            {this.#copy}
          </div>
        </div>
        <div className="prix-bar-track">
          {categories.map((name, index) => {
            const segment = (<div className="prix-segment" data-category={name} />) as HTMLElement;
            segment.style.backgroundColor =
              name === 'code' ? CODE_COLOR : PALETTE[index % PALETTE.length];
            this.#segments.set(name, segment);
            return segment;
          })}
        </div>
        <div className="prix-bar-legend">
          {categories.map((name, index) => {
            const meta = (<span className="prix-chip-meta" />) as unknown as HTMLSpanElement;
            const state = (<span className="prix-chip-state" aria-hidden="true" />) as HTMLElement;
            const chip = (
              <button type="button" className="prix-chip" data-category={name} data-state="visible">
                <span className="prix-dot" />
                <span className="prix-chip-name">{name}</span>
                {meta}
                {state}
              </button>
            ) as unknown as HTMLElement;
            // The category colour as a custom property so CSS can render the
            // hollow-dot states (border in the category colour) without JS
            chip.style.setProperty(
              '--prix-cat',
              name === 'code' ? CODE_COLOR : PALETTE[index % PALETTE.length],
            );
            chip.addEventListener('click', () => {
              handlers.onCycle(name);
            });
            this.#chips.set(name, chip);
            this.#chipMeta.set(name, meta);
            this.#chipState.set(name, state);
            return chip;
          })}
        </div>
        <div className="prix-bar-footer">
          <div className="prix-focus-summary">
            {this.#summary}
            {this.#diffstat}
          </div>
          <div className="prix-navigation">
            {this.#progress}
            <span className="prix-shortcut" title="Shift+J / Shift+K">
              Jump to file
            </span>
            {controlButton(ICONS.up, 'Previous visible file (Shift+K)', () => handlers.onJump(-1))}
            {controlButton(ICONS.down, 'Next visible file (Shift+J)', () => handlers.onJump(1))}
          </div>
        </div>
        {this.#status}
        {this.#chartLine}
      </section>
    ) as unknown as HTMLElement;
  }

  async #copyReport(handlers: BarHandlers): Promise<void> {
    if (this.#copy.disabled) return;
    clearTimeout(this.#copyTimer);
    this.#copy.disabled = true;
    try {
      await handlers.onCopy();
      setText(this.#status, 'Report copied to clipboard');
      this.#status.dataset.tone = 'success';
    } catch {
      setText(this.#status, 'Couldn’t copy. Allow clipboard access, then try again.');
      this.#status.dataset.tone = 'error';
    } finally {
      this.#copy.disabled = false;
      this.#copyTimer = setTimeout(() => setText(this.#status, ''), 5000);
    }
  }

  destroy(): void {
    clearTimeout(this.#copyTimer);
    this.element.remove();
  }

  /** Language "PR Impact Map" summary line, shown under the legend when the PR has one. */
  setImpactMap(map: ImpactMap | null): void {
    if (!map) {
      this.#chartLine.hidden = true;
      return;
    }

    this.#chartLine.hidden = false;
    this.#chartLine.textContent = `Impact Map: ${map.categories
      .map((category) => `${category.name} ${category.share}%`)
      .join(' · ')}`;
    this.#chartLine.title = `Posted by the Language bot on this PR (${map.totalFiles} files, +${map.totalAdded} / -${map.totalRemoved})`;
  }

  update(
    counts: ReadonlyMap<string, CategoryCount>,
    stateOf: (category: string) => DisplayState,
    visibleCounts?: ReadonlyMap<string, CategoryCount>,
  ): void {
    let totalAdded = 0;
    let totalRemoved = 0;
    let totalFiles = 0;
    let totalReviewed = 0;
    let shownAdded = 0;
    let shownRemoved = 0;
    let shownFiles = 0;
    let filtering = false;
    for (const name of this.#categories) {
      const count = counts.get(name) ?? {files: 0, added: 0, removed: 0, reviewed: 0};
      totalAdded += count.added;
      totalRemoved += count.removed;
      totalFiles += count.files;
      totalReviewed += count.reviewed;

      const state = stateOf(name);
      if (count.files > 0 && state !== 'visible') {
        filtering = true;
      }

      if (state === 'visible') {
        shownFiles += count.files;
        shownAdded += count.added;
        shownRemoved += count.removed;
      }
    }

    if (visibleCounts) {
      shownAdded = 0;
      shownRemoved = 0;
      shownFiles = 0;
      for (const count of visibleCounts.values()) {
        shownAdded += count.added;
        shownRemoved += count.removed;
        shownFiles += count.files;
      }
      filtering = shownFiles < totalFiles;
    }
    const totalLines = totalAdded + totalRemoved;
    const shownLines = shownAdded + shownRemoved;

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
      const grow = String(count.files > 0 ? share : 0);
      if (segment.style.flexGrow !== grow) segment.style.flexGrow = grow;
      if (segment.hidden !== (count.files === 0)) segment.hidden = count.files === 0;
      setAttribute(segment, 'data-state', state);

      const filesText = `${count.files} ${count.files === 1 ? 'file' : 'files'}`;
      const linesText = lines > 0 ? ` · ${lines} lines` : '';
      const percent = `${Math.round(share * 100)}%`;
      const shareText = total > 0 && count.files > 0 ? ` · ${percent}` : '';
      const reviewedText =
        count.reviewed > 0 ? ` · ${count.reviewed} of ${count.files} reviewed` : '';
      const detail = `${name} - ${filesText}${linesText}${shareText}${reviewedText}`;

      // The chip shows name + percentage only; the full breakdown and the
      // cycle explanation live in the tooltip and aria-label.
      const NEXT_ACTION: Record<DisplayState, string> = {
        visible: 'collapse',
        collapsed: 'hide',
        hidden: 'show',
      };
      const chip = this.#chips.get(name)!;
      setAttribute(chip, 'data-state', state);
      if (chip.hidden !== (count.files === 0)) chip.hidden = count.files === 0;
      setAttribute(chip, 'title', `${detail} - click to cycle visible → collapsed → hidden`);
      setAttribute(
        chip,
        'aria-label',
        `${name}, ${percent}, ${state} - click to ${NEXT_ACTION[state]}`,
      );
      setText(this.#chipMeta.get(name)!, percent);
      setText(
        this.#chipState.get(name)!,
        state === 'visible' ? 'Expanded' : state === 'collapsed' ? 'Collapsed' : 'Hidden',
      );
      setAttribute(segment, 'title', detail);
    }

    setText(
      this.#totals,
      `${totalFiles} ${totalFiles === 1 ? 'file' : 'files'} · ${totalLines} lines` +
        (totalReviewed > 0 ? ` · ${totalReviewed} reviewed` : ''),
    );
    const reduction = totalLines > 0 ? Math.round((1 - shownLines / totalLines) * 100) : 0;
    setText(
      this.#summary,
      totalFiles === 0
        ? 'Waiting for files…'
        : filtering
          ? `${shownFiles} of ${totalFiles} files expanded${reduction > 0 ? ` · ${reduction}% fewer lines` : ''}`
          : 'All files expanded',
    );
    this.#progress.value = totalFiles > 0 ? (totalReviewed / totalFiles) * 100 : 0;
    this.#progress.title = `${totalReviewed} of ${totalFiles} files reviewed`;
    this.#progress.setAttribute('aria-valuetext', this.#progress.title);
    this.#progress.hidden = totalReviewed === 0;
    setAttribute(this.#expand, 'aria-pressed', String(totalFiles > 0 && !filtering));
    setAttribute(
      this.#focus,
      'aria-pressed',
      String(
        totalFiles > 0 &&
          this.#categories.every(
            (name) => stateOf(name) === (name === 'code' ? 'visible' : 'collapsed'),
          ),
      ),
    );

    // Condensed diffstat: only while filtering removes lines from view, and
    // only when line counts exist to compare (unparsed/virtualised rows can
    // leave everything at 0 - file counts would make a nonsense diffstat).
    if (!filtering || totalLines === 0 || shownLines === totalLines) {
      this.#diffstat.hidden = true;
    } else {
      this.#diffstat.hidden = false;
      setText(
        this.#diffstatOrig,
        `+${totalAdded.toLocaleString('en-US')} −${totalRemoved.toLocaleString('en-US')}`,
      );
      setText(this.#diffstatShownAdded, `+${shownAdded.toLocaleString('en-US')}`);
      setText(this.#diffstatShownRemoved, `−${shownRemoved.toLocaleString('en-US')}`);
      const filled = Math.round((shownLines / totalLines) * this.#diffstatBlocks.length);
      this.#diffstatBlocks.forEach((block, index) => {
        block.classList.toggle('prix-diffstat-block--filled', index < filled);
      });
      this.#diffstat.title =
        `Filtering is on: +${shownAdded} −${shownRemoved} of +${totalAdded} −${totalRemoved} lines still shown ` +
        '(collapsed and hidden categories excluded)';
    }
  }
}
