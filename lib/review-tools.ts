import {browser} from 'wxt/browser';
import {ChangeMap, type MapFile} from './change-map';
import type {ReviewPreset} from './preferences';

export interface ReviewToolHandlers {
  unreviewed: (value: boolean) => void;
  comments: (value: boolean) => void;
  savePreset: (name: string) => Promise<void>;
  applyPreset: (name: string) => void;
  deletePreset: (name: string) => Promise<void>;
  clearOverrides: () => void;
  focusDirectory: (path: string) => void;
  openFile: (path: string) => void;
}
export class ReviewTools {
  readonly element = document.createElement('div');
  readonly map: ChangeMap;
  #unreviewed = document.createElement('input');
  #comments = document.createElement('input');
  #coverage = document.createElement('span');
  #overrides = document.createElement('button');
  #directory = document.createElement('button');
  #presets = document.createElement('select');
  #status = document.createElement('span');
  #presetSignature = '';

  constructor(handlers: ReviewToolHandlers, signal: AbortSignal, repo = '') {
    this.element.className = 'prix-review-tools';
    const filters = document.createElement('div');
    filters.className = 'prix-review-filters';
    const toggle = (
      input: HTMLInputElement,
      text: string,
      change: (value: boolean) => void,
    ): HTMLLabelElement => {
      const label = document.createElement('label');
      input.type = 'checkbox';
      input.setAttribute('aria-label', text);
      input.addEventListener('change', () => change(input.checked));
      label.append(input, text);
      return label;
    };
    filters.append(
      toggle(this.#unreviewed, 'Unreviewed only', handlers.unreviewed),
      toggle(this.#comments, 'Exclude comment-only lines', handlers.comments),
    );
    this.#comments.title =
      'Exclude recognized comment-only additions and deletions. Inline code and blank lines still count.';
    this.#overrides.type = 'button';
    this.#overrides.className = 'prix-filter-reset';
    this.#overrides.addEventListener('click', handlers.clearOverrides);
    this.#directory.type = 'button';
    this.#directory.className = 'prix-filter-reset';
    this.#directory.addEventListener('click', () => handlers.focusDirectory(''));
    filters.append(this.#overrides, this.#directory);
    const settings = document.createElement('a');
    settings.className = 'prix-settings-link';
    settings.textContent = 'Settings';
    settings.href =
      browser.runtime.getURL('/popup.html') + (repo ? `?repo=${encodeURIComponent(repo)}` : '');
    settings.target = '_blank';
    settings.rel = 'noopener';
    settings.addEventListener('click', (event) => {
      if (settings.protocol === 'http:' || settings.protocol === 'https:') return;
      // Extension pages cannot be navigated to directly by a GitHub page.
      event.preventDefault();
      void browser.runtime
        .sendMessage({type: 'prix:settings'})
        .then((result) => {
          if (!result?.opened)
            this.announce('Open PR Impact from your browser toolbar to change settings.');
        })
        .catch(() => this.announce('Open PR Impact from your browser toolbar to change settings.'));
    });
    filters.append(settings);
    const presets = document.createElement('details');
    presets.className = 'prix-saved-views';
    const summary = document.createElement('summary');
    summary.textContent = 'Saved views';
    const presetControls = document.createElement('div');
    presetControls.className = 'prix-saved-controls';
    this.#presets.setAttribute('aria-label', 'Saved review preset');
    this.#presets.append(new Option('Choose a saved view…', ''));
    this.#presets.addEventListener('change', () => {
      if (this.#presets.value) handlers.applyPreset(this.#presets.value);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete view';
    remove.addEventListener('click', () => {
      if (this.#presets.value)
        void handlers
          .deletePreset(this.#presets.value)
          .catch(() => this.announce('Couldn’t delete the view. Try again.'));
    });
    const form = document.createElement('form');
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 40;
    name.placeholder = 'Name this view';
    name.required = true;
    name.setAttribute('aria-label', 'New preset name');
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save current view';
    form.append(name, save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!name.value.trim()) return;
      void handlers
        .savePreset(name.value.trim())
        .then(() => {
          this.announce(`Saved “${name.value.trim()}” for this repository`);
          name.value = '';
        })
        .catch((error) =>
          this.announce(
            error instanceof Error ? error.message : 'Couldn’t save the view. Try again.',
          ),
        );
    });
    presetControls.append(this.#presets, remove, form);
    presets.append(summary, presetControls);
    this.#coverage.className = 'prix-coverage';
    this.#status.className = 'prix-tools-status';
    this.#status.setAttribute('role', 'status');
    this.map = new ChangeMap(handlers.openFile, handlers.focusDirectory, signal);
    this.element.append(filters, presets, this.#coverage, this.#status, this.map.element);
  }

  announce(text: string): void {
    this.#status.textContent = text;
  }

  update(options: {
    unreviewed: boolean;
    excludeComments: boolean;
    overrides: number;
    directory: string;
    presets: ReviewPreset[];
    coverage: string;
    files: MapFile[];
  }): void {
    this.#unreviewed.checked = options.unreviewed;
    this.#comments.checked = options.excludeComments;
    this.#overrides.hidden = options.overrides === 0;
    this.#overrides.textContent = `${options.overrides} file overrides · reset`;
    this.#directory.hidden = !options.directory;
    this.#directory.textContent = `${options.directory}/ · clear folder focus`;
    if (this.#coverage.textContent !== options.coverage)
      this.#coverage.textContent = options.coverage;
    const signature = options.presets.map((preset) => preset.name).join('\0');
    if (signature !== this.#presetSignature) {
      this.#presetSignature = signature;
      const current = this.#presets.value;
      this.#presets.replaceChildren(
        new Option('Choose a saved view…', ''),
        ...options.presets.map((preset) => new Option(preset.name, preset.name)),
      );
      this.#presets.value = options.presets.some((preset) => preset.name === current)
        ? current
        : '';
    }
    this.map.update(options.files, options.directory);
  }
}
