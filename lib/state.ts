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

type Listener = (category: string, state: DisplayState) => void;

/**
 * Per-category display states. Persisted in chrome.storage.local under one
 * key as a `{categoryName: state}` map; user-set states override the config
 * file's `action` defaults on later visits.
 */
export class CategoryStateStore {
  #states = new Map<string, DisplayState>();
  #listeners = new Set<Listener>();

  /**
   * Storage failures (dead context after an extension reload, quota, ...) must
   * not take init down with them - the feature works fine on default states.
   */
  async load(): Promise<void> {
    let value: unknown;
    try {
      const stored = await browser.storage.local.get(STORAGE_KEY);
      value = stored[STORAGE_KEY];
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
    this.#states.set(category, state);
    browser.storage.local.set({[STORAGE_KEY]: Object.fromEntries(this.#states)}).catch(error => {
      console.warn('[PR Impact]', 'category-states-write', error);
    });
    for (const listener of this.#listeners) {
      listener(category, state);
    }
  }

  subscribe(listener: Listener): void {
    this.#listeners.add(listener);
  }
}
