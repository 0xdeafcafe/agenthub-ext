import type {DisplayState} from './state';

export interface MapFile {
  path: string;
  category: string;
  added: number;
  removed: number;
  viewed: boolean;
  state: DisplayState;
}
export interface MapGroup {
  path: string;
  name: string;
  directory: boolean;
  files: MapFile[];
  weight: number;
}
export interface Tile {
  group: MapGroup;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function groupChanges(files: MapFile[], directory = ''): MapGroup[] {
  const prefix = directory ? `${directory}/` : '';
  const groups = new Map<string, MapGroup>();
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const relative = file.path.slice(prefix.length);
    const slash = relative.indexOf('/');
    const name = slash >= 0 ? relative.slice(0, slash) : relative;
    const path = prefix + name;
    const group = groups.get(path) ?? {path, name, directory: slash >= 0, files: [], weight: 0};
    group.files.push(file);
    group.weight += Math.max(1, file.added + file.removed);
    groups.set(path, group);
  }
  return [...groups.values()].sort((a, b) => b.weight - a.weight || a.path.localeCompare(b.path));
}

/** Balanced binary treemap: deterministic, no simulation or animation loop. */
export function layoutMap(groups: MapGroup[], width = 1000, height = 300): Tile[] {
  const tiles: Tile[] = [];
  const split = (items: MapGroup[], x: number, y: number, w: number, h: number): void => {
    if (!items.length) return;
    if (items.length === 1) {
      tiles.push({
        group: items[0],
        x: (x / width) * 100,
        y: (y / height) * 100,
        width: (w / width) * 100,
        height: (h / height) * 100,
      });
      return;
    }
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let left = items[0].weight;
    let cut = 1;
    while (
      cut < items.length - 1 &&
      Math.abs(total / 2 - (left + items[cut].weight)) < Math.abs(total / 2 - left)
    )
      left += items[cut++].weight;
    const ratio = left / total;
    if (w >= h) {
      split(items.slice(0, cut), x, y, w * ratio, h);
      split(items.slice(cut), x + w * ratio, y, w * (1 - ratio), h);
    } else {
      split(items.slice(0, cut), x, y, w, h * ratio);
      split(items.slice(cut), x, y + h * ratio, w, h * (1 - ratio));
    }
  };
  split(groups, 0, 0, width, height);
  return tiles;
}

const color = (category: string): string =>
  ({code: '#5b8def', tests: '#49a983', specs: '#ad8aed', docs: '#d1a44d', generated: '#8b93a7'})[
    category
  ] ?? '#a884dc';
const button = (label: string, click: () => void): HTMLButtonElement => {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', click);
  return element;
};

export class ChangeMap {
  readonly element = document.createElement('details');
  #files: MapFile[] = [];
  #directory = '';
  #focused = false;
  #canvas = document.createElement('div');
  #list = document.createElement('div');
  #breadcrumbs = document.createElement('div');
  #summary = document.createElement('span');
  #focus: HTMLButtonElement;
  #signature = '';
  #focusDirectory = '';
  readonly #onFocus: (directory: string) => void;
  #width = 0;
  #resize: ResizeObserver;
  readonly #onOpen: (path: string) => void;

  constructor(
    onOpen: (path: string) => void,
    onFocus: (directory: string) => void,
    signal: AbortSignal,
  ) {
    this.#onOpen = onOpen;
    this.#onFocus = onFocus;
    this.element.className = 'prix-change-map';
    const summary = document.createElement('summary');
    summary.textContent = 'Change map';
    this.#summary.className = 'prix-map-caption';
    summary.append(this.#summary);
    const toolbar = document.createElement('div');
    toolbar.className = 'prix-map-toolbar';
    this.#breadcrumbs.className = 'prix-map-breadcrumbs';
    const label = document.createElement('label');
    const focused = document.createElement('input');
    focused.type = 'checkbox';
    focused.setAttribute('aria-label', 'Map expanded files only');
    focused.addEventListener('change', () => {
      this.#focused = focused.checked;
      this.#render();
    });
    label.append(focused, ' Expanded files only');
    this.#focus = button('Focus this folder', () => onFocus(this.#directory));
    this.#focus.className = 'prix-map-focus';
    toolbar.append(this.#breadcrumbs, label, this.#focus);
    this.#canvas.className = 'prix-map-canvas';
    this.#canvas.setAttribute('aria-label', 'Changed files grouped by directory');
    this.#list.className = 'prix-map-list';
    this.#list.setAttribute('aria-label', 'Changes in this folder');
    const note = document.createElement('p');
    note.className = 'prix-map-note';
    note.textContent =
      'Area follows changed lines. Open a folder to explore it, or a file to review it. Binary and zero-line files keep a small tile.';
    this.element.append(summary, toolbar, this.#canvas, this.#list, note);
    this.element.addEventListener('toggle', () => {
      if (this.element.open) this.#render();
    });
    this.#resize = new ResizeObserver((entries) => {
      const width = Math.round(entries[0].contentRect.width);
      if (width > 0 && width !== this.#width) {
        this.#width = width;
        if (this.element.open) this.#render();
      }
    });
    this.#resize.observe(this.#canvas);
    signal.addEventListener('abort', () => this.#resize.disconnect(), {once: true});
  }

  update(files: MapFile[], focusDirectory = ''): void {
    if (focusDirectory !== this.#focusDirectory) {
      this.#focusDirectory = focusDirectory;
      this.#directory = focusDirectory;
    }
    const signature = JSON.stringify([files, focusDirectory]);
    if (signature === this.#signature) return;
    this.#signature = signature;
    this.#files = files;
    this.#summary.textContent = `${files.length} files · explore clusters`;
    if (this.element.open) this.#render();
  }

  #render(): void {
    const files = this.#focused
      ? this.#files.filter((file) => file.state === 'visible')
      : this.#files;
    const groups = groupChanges(files, this.#directory);
    this.#breadcrumbs.replaceChildren(
      button('All changes', () => {
        this.#directory = '';
        this.#onFocus('');
        this.#render();
      }),
    );
    const parts = this.#directory.split('/').filter(Boolean);
    parts.forEach((part, i) => {
      this.#breadcrumbs.append(
        ' / ',
        button(part, () => {
          this.#directory = parts.slice(0, i + 1).join('/');
          this.#render();
        }),
      );
    });
    this.#focus.hidden = !this.#directory;
    this.#canvas.replaceChildren();
    this.#list.replaceChildren();
    if (!groups.length) {
      this.#canvas.textContent =
        'No files in this view. Try all changes or include collapsed files.';
      return;
    }
    const activate = (group: MapGroup): void => {
      if (group.directory) {
        this.#directory = group.path;
        this.#render();
      } else this.#onOpen(group.path);
    };
    for (const tile of layoutMap(groups, this.#width || 1000, 280)) {
      const {group} = tile;
      const lines = group.files.reduce((sum, file) => sum + file.added + file.removed, 0);
      const category = [...group.files].sort((a, b) => b.added + b.removed - a.added - a.removed)[0]
        .category;
      const element = button('', () => activate(group));
      element.className = 'prix-map-tile';
      element.style.cssText = `left:${tile.x}%;top:${tile.y}%;width:${tile.width}%;height:${tile.height}%;--prix-map-color:${color(category)}`;
      element.dataset.dimmed = String(group.files.every((file) => file.state !== 'visible'));
      element.title = `${group.path}${group.directory ? '/' : ''} · ${group.files.length} files · ${lines.toLocaleString()} lines`;
      element.setAttribute(
        'aria-label',
        `${group.directory ? 'Explore folder' : 'Open file'} ${group.path}, ${lines} changed lines`,
      );
      const title = document.createElement('strong');
      title.textContent = group.name + (group.directory ? '/' : '');
      const meta = document.createElement('span');
      meta.textContent = `${lines.toLocaleString()} lines${group.directory ? ` · ${group.files.length} files` : ''}`;
      element.append(title, meta);
      this.#canvas.append(element);
      const row = button('', () => activate(group));
      row.className = 'prix-map-row';
      const name = document.createElement('span');
      name.textContent = group.name + (group.directory ? '/' : '');
      const count = document.createElement('span');
      count.textContent = `${lines.toLocaleString()} lines`;
      row.append(name, count);
      this.#list.append(row);
    }
  }
}
