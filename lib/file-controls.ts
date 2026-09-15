import type {DisplayState} from './state';

export interface FileControlOptions {
  category: string;
  categories: string[];
  explanation: string;
  overriddenCategory: string | undefined;
  override: DisplayState | undefined;
  state: DisplayState;
  onState: (state: DisplayState | undefined) => void;
  onCategory: (category: string | undefined) => void;
}

/** A native dialog escapes clipped GitHub headers and handles focus/Escape. */
export function injectFileControls(header: Element, options: FileControlOptions): void {
  let controls = header.querySelector<HTMLElement>('.prix-file-controls');
  if (controls && !bindings.has(controls)) {
    controls.remove();
    controls = null;
  }
  if (!controls) {
    controls = document.createElement('span');
    controls.className = 'prix-file-controls';
    const summary = document.createElement('button');
    summary.type = 'button';
    summary.setAttribute('aria-label', 'File options');
    summary.className = 'prix-file-menu';
    summary.textContent = '⋯';
    summary.title = 'Override visibility or explain this file’s category';
    const panel = document.createElement('dialog');
    panel.className = 'prix-file-popover';
    panel.setAttribute('aria-label', 'File review options');
    summary.addEventListener('click', () => panel.showModal());
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Done';
    close.addEventListener('click', () => panel.close());
    const explanation = document.createElement('p');
    explanation.className = 'prix-classification-reason';
    const visibility = document.createElement('select');
    visibility.setAttribute('aria-label', 'Visibility for this file');
    visibility.className = 'prix-file-visibility';
    for (const [value, label] of [
      ['', 'Follow category'],
      ['visible', 'Expanded'],
      ['collapsed', 'Collapsed'],
      ['hidden', 'Hidden'],
    ])
      visibility.append(new Option(label, value));
    const category = document.createElement('select');
    category.setAttribute('aria-label', 'Category for this file');
    category.className = 'prix-file-category';
    category.append(
      new Option('Use classification rules', ''),
      ...options.categories.map((name) => new Option(name, name)),
    );
    const visibilityLabel = document.createElement('label');
    visibilityLabel.append('This file’s visibility', visibility);
    const categoryLabel = document.createElement('label');
    categoryLabel.append('Category in this repository', category);
    const note = document.createElement('small');
    note.textContent =
      'Visibility applies to this PR visit. Category corrections are remembered for this repository.';
    panel.append(explanation, visibilityLabel, categoryLabel, note, close);
    controls.append(summary, panel);
    header.append(controls);
    // Handlers use the latest options even when GitHub retains a header node.
    visibility.addEventListener('change', () => {
      panel.close();
      bindings
        .get(controls!)!
        .onState(visibility.value ? (visibility.value as DisplayState) : undefined);
    });
    category.addEventListener('change', () => {
      panel.close();
      bindings.get(controls!)!.onCategory(category.value || undefined);
    });
    controls.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        panel.close();
        summary.focus();
      }
    });
  }
  bindings.set(controls, options);
  const visibility = controls.querySelector<HTMLSelectElement>('.prix-file-visibility')!;
  const category = controls.querySelector<HTMLSelectElement>('.prix-file-category')!;
  visibility.value = options.override ?? '';
  category.value = options.overriddenCategory ?? '';
  const reason = controls.querySelector('.prix-classification-reason')!;
  if (reason.textContent !== options.explanation) reason.textContent = options.explanation;
}
const bindings = new WeakMap<Element, FileControlOptions>();
