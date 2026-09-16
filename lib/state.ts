import {browser} from 'wxt/browser';
import {actionFor, type CategoryAction, type CompiledRule} from './classifier';

export type DisplayState = 'visible' | 'collapsed' | 'hidden';

const STATE_ORDER: DisplayState[] = ['visible', 'collapsed', 'hidden'];

export function cycleState(current: DisplayState): DisplayState {
  const index = STATE_ORDER.indexOf(current);
  return STATE_ORDER[(index + 1) % STATE_ORDER.length];
}

export function actionToState(action: CategoryAction): DisplayState {
  switch (action) {
    case 'collapse': {
      return 'collapsed';
    }

    case 'hide': {
      return 'hidden';
    }

    default: {
      return 'visible';
    }
  }
}

export function isDisplayState(value: unknown): value is DisplayState {
  return value === 'visible' || value === 'collapsed' || value === 'hidden';
}

/**
 * The state a category starts in before any user choice. With a defaultView
 * list it's binary: listed categories visible, everything else hidden (zero
 * scroll space). Without one, the category's configured action rules.
 */
export function defaultStateFor(
  category: string,
  rules: CompiledRule[],
  defaultView: string[] | null,
): DisplayState {
  if (defaultView) {
    return defaultView.includes(category) ? 'visible' : 'hidden';
  }

  return actionToState(actionFor(category, rules));
}

const STORAGE_KEY = 'prix:categoryStates';

type Listener = (categories: ReadonlySet<string>) => void;

/**
 * Per-category display states. Persisted in chrome.storage.local under one
 * key as a `{categoryName: state}` map; user-set states override the config
 * file's `action` defaults on later visits.
 */
export class CategoryStateStore {
  #states = new Map<string, DisplayState>();
  #listeners = new Set<Listener>();
  #writePending = false;
  readonly #key: string;

  constructor(repo?: string) {
    this.#key = repo ? `${STORAGE_KEY}:${repo}` : STORAGE_KEY;
  }

  watch(signal: AbortSignal): void {
    const changed = (changes: Record<string, {newValue?: unknown}>, area: string): void => {
      if (area !== 'local' || !(this.#key in changes)) return;
      const value = changes[this.#key].newValue;
      const next = new Map<string, DisplayState>();
      if (value && typeof value === 'object')
        for (const [name, state] of Object.entries(value))
          if (isDisplayState(state)) next.set(name, state);
      const names = new Set(
        [...this.#states.keys(), ...next.keys()].filter(
          (name) => this.#states.get(name) !== next.get(name),
        ),
      );
      this.#states = next;
      if (names.size) for (const listener of this.#listeners) listener(names);
    };
    browser.storage.onChanged.addListener(changed);
    signal.addEventListener('abort', () => browser.storage.onChanged.removeListener(changed), {
      once: true,
    });
  }

  /**
   * Storage failures (dead context after an extension reload, quota, ...) must
   * not take init down with them - the feature works fine on default states.
   */
  async load(): Promise<void> {
    let value: unknown;
    try {
      const stored = await browser.storage.local.get(this.#key);
      value = stored[this.#key];
    } catch (error) {
      console.warn('[PR Impact]', 'category-states-load', error);
      return;
    }

    if (typeof value === 'object' && value !== null) {
      for (const [category, state] of Object.entries(value)) {
        if (isDisplayState(state)) {
          this.#states.set(category, state);
        }
      }
    }
  }

  get(category: string, fallback: DisplayState): DisplayState {
    return this.#states.get(category) ?? fallback;
  }

  cycle(category: string, fallback: DisplayState): DisplayState {
    const next = cycleState(this.get(category, fallback));
    this.set(category, next);
    return next;
  }

  set(category: string, state: DisplayState): void {
    this.setMany([[category, state]]);
  }

  /** Apply a preset with one notification and one storage write. */
  setMany(entries: Iterable<readonly [string, DisplayState]>): void {
    const changed = new Set<string>();
    for (const [category, state] of entries) {
      if (this.#states.get(category) === state) continue;
      this.#states.set(category, state);
      changed.add(category);
    }
    if (changed.size === 0) return;
    if (!this.#writePending) {
      this.#writePending = true;
      queueMicrotask(() => {
        this.#writePending = false;
        void this.#persist();
      });
    }
    for (const listener of this.#listeners) {
      listener(changed);
    }
  }

  subscribe(listener: Listener): void {
    this.#listeners.add(listener);
  }

  async #persist(): Promise<void> {
    try {
      await browser.storage.local.set({[this.#key]: Object.fromEntries(this.#states)});
    } catch (error) {
      console.warn('[PR Impact]', 'category-states-write', error);
    }
  }
}
