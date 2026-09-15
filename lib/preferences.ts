import {browser} from 'wxt/browser';
import {isDisplayState, type DisplayState} from './state';

export const SETTINGS_KEY = 'prix:settings';
export const repoPreferencesKey = (repo: string): string => `prix:preferences:${repo}`;
export interface GlobalSettings {
  enabled: boolean;
  unreviewed: boolean;
  excludeComments: boolean;
  defaultStates: Record<string, DisplayState>;
}
export interface ReviewPreset {
  name: string;
  states: Record<string, DisplayState>;
  unreviewed: boolean;
  excludeComments: boolean;
  directory: string;
}
export interface RepoPreferences {
  unreviewed?: boolean;
  excludeComments?: boolean;
  classifications: Record<string, string>;
  presets: ReviewPreset[];
}
export const DEFAULT_SETTINGS: GlobalSettings = {
  enabled: true,
  unreviewed: false,
  excludeComments: false,
  defaultStates: {},
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function validStates(value: unknown): Record<string, DisplayState> {
  return Object.fromEntries(
    Object.entries(object(value)).filter((entry): entry is [string, DisplayState] =>
      isDisplayState(entry[1]),
    ),
  );
}
export function parseSettings(value: unknown): GlobalSettings {
  const data = object(value);
  return {
    enabled: data.enabled !== false,
    unreviewed: data.unreviewed === true,
    excludeComments: data.excludeComments === true,
    defaultStates: validStates(data.defaultStates),
  };
}
export function parseRepoPreferences(value: unknown): RepoPreferences {
  const data = object(value);
  return {
    ...(typeof data.unreviewed === 'boolean' ? {unreviewed: data.unreviewed} : {}),
    ...(typeof data.excludeComments === 'boolean' ? {excludeComments: data.excludeComments} : {}),
    classifications: Object.fromEntries(
      Object.entries(object(data.classifications)).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    presets: Array.isArray(data.presets)
      ? data.presets.slice(0, 20).flatMap((raw) => {
          const preset = object(raw);
          if (typeof preset.name !== 'string' || !preset.name.trim()) return [];
          return [
            {
              name: preset.name.trim().slice(0, 40),
              states: validStates(preset.states),
              unreviewed: preset.unreviewed === true,
              excludeComments: preset.excludeComments === true,
              directory: typeof preset.directory === 'string' ? preset.directory : '',
            },
          ];
        })
      : [],
  };
}

export async function loadSettings(): Promise<GlobalSettings> {
  try {
    const values = await browser.storage.local.get([SETTINGS_KEY, 'prix:categoryStates']);
    return values[SETTINGS_KEY]
      ? parseSettings(values[SETTINGS_KEY])
      : {...DEFAULT_SETTINGS, defaultStates: validStates(values['prix:categoryStates'])};
  } catch {
    return {...DEFAULT_SETTINGS};
  }
}

/** One key per repo keeps preferences independent across repositories. */
export class ReviewPreferences {
  global: GlobalSettings = {...DEFAULT_SETTINGS};
  repo: RepoPreferences = {classifications: {}, presets: []};
  readonly key: string;
  #listeners = new Set<() => void>();
  #write = Promise.resolve();

  constructor(repo: string) {
    this.key = repoPreferencesKey(repo);
  }
  async load(signal: AbortSignal): Promise<void> {
    this.global = await loadSettings();
    try {
      this.repo = parseRepoPreferences((await browser.storage.local.get(this.key))[this.key]);
    } catch {
      /* Defaults work offline. */
    }
    if (signal.aborted) return;
    const onChange = (changes: Record<string, {newValue?: unknown}>, area: string): void => {
      if (area !== 'local') return;
      if (SETTINGS_KEY in changes) this.global = parseSettings(changes[SETTINGS_KEY].newValue);
      if (this.key in changes) this.repo = parseRepoPreferences(changes[this.key].newValue);
      if (this.key in changes || SETTINGS_KEY in changes) this.#emit();
    };
    browser.storage.onChanged.addListener(onChange);
    signal.addEventListener('abort', () => browser.storage.onChanged.removeListener(onChange), {
      once: true,
    });
  }
  get unreviewed(): boolean {
    return this.repo.unreviewed ?? this.global.unreviewed;
  }
  get excludeComments(): boolean {
    return this.repo.excludeComments ?? this.global.excludeComments;
  }
  subscribe(listener: () => void): void {
    this.#listeners.add(listener);
  }
  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
  async update(change: Partial<RepoPreferences>): Promise<void> {
    this.repo = {...this.repo, ...change};
    this.#emit();
    const snapshot = structuredClone(this.repo);
    this.#write = this.#write
      .catch(() => {})
      .then(() => browser.storage.local.set({[this.key]: snapshot}));
    await this.#write;
  }
}
