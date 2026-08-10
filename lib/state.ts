import {browser} from 'wxt/browser';
import type {CategoryAction} from './classifier';

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

  async load(): Promise<void> {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const value: unknown = stored[STORAGE_KEY];
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
    void browser.storage.local.set({[STORAGE_KEY]: Object.fromEntries(this.#states)});
    for (const listener of this.#listeners) {
      listener(category, state);
    }
  }

  subscribe(listener: Listener): void {
    this.#listeners.add(listener);
  }
}
