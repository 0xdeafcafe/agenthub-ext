import {adapterFor} from './views';
import type {DisplayState} from './state';

export const VIRTUAL_LAYOUT_SELECTOR =
  '[data-virtualizer], [data-virtuoso-scroller], [data-virtual-index], [data-index], [class*="Virtualized"], [class*="virtualized"]';

export function isVirtualFile(container: Element): boolean {
  return (
    adapterFor(container)?.name === 'react' &&
    (new URLSearchParams(location.search).get('mode') === 'virtualization' ||
      container.closest(VIRTUAL_LAYOUT_SELECTOR) !== null)
  );
}

export function nativeFileToggle(container: Element): HTMLButtonElement | null {
  const header = adapterFor(container)?.getHeader(container);
  for (const button of header?.querySelectorAll<HTMLButtonElement>('button') ?? []) {
    if (button.closest('.prix-file-controls')) continue;
    const label = `${button.getAttribute('aria-label') ?? ''} ${button.title} ${button.getAttribute('data-testid') ?? ''}`;
    if (/(?:expand|collapse|toggle)/i.test(label) && /(?:file|diff)/i.test(label)) return button;
  }
  return null;
}

export function isFileExpanded(button: HTMLButtonElement): boolean | null {
  const expanded = button.getAttribute('aria-expanded');
  if (expanded !== null) return expanded === 'true';
  const label = `${button.getAttribute('aria-label') ?? ''} ${button.title}`;
  return /collapse/i.test(label) ? true : /expand/i.test(label) ? false : null;
}

/** Let GitHub update its own height model; never hide or resize a measured slot. */
export class VirtualFiles {
  #requests = new WeakMap<Element, {button: HTMLButtonElement; expanded: boolean}>();
  #original = new Map<Element, {expanded: boolean; requested: boolean}>();

  constructor(signal: AbortSignal) {
    signal.addEventListener(
      'abort',
      () => {
        for (const [container, original] of this.#original) {
          if (!container.isConnected) continue;
          const button = nativeFileToggle(container);
          if (
            button &&
            isFileExpanded(button) === original.requested &&
            original.expanded !== original.requested
          )
            button.click();
        }
        this.#original.clear();
      },
      {once: true},
    );
  }

  apply(container: Element, state: DisplayState): void {
    for (const element of this.#original.keys())
      if (!element.isConnected) this.#original.delete(element);
    const button = nativeFileToggle(container);
    if (!button) return; // A loading skeleton must keep its estimated height.
    const current = isFileExpanded(button);
    if (current === null) return;
    const expanded = state === 'visible';
    if (current === expanded) {
      this.#requests.delete(container);
      return;
    }
    const pending = this.#requests.get(container);
    if (pending?.button === button && pending.expanded === expanded) return;
    const original = this.#original.get(container) ?? {expanded: current, requested: expanded};
    original.requested = expanded;
    this.#original.set(container, original);
    this.#requests.set(container, {button, expanded});
    button.click();
  }

  forget(container: Element): void {
    this.#original.delete(container);
    this.#requests.delete(container);
  }

  userToggle(container: Element, expanded: boolean): void {
    this.forget(container);
    const button = nativeFileToggle(container);
    // React may commit the user's click after our next animation frame.
    if (button) this.#requests.set(container, {button, expanded});
  }
}
