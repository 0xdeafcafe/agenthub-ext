import {parse} from 'yaml';
import type {CategoryAction, CategoryRule} from './classifier';

export const DEFAULT_CATEGORIES: CategoryRule[] = [
  {
    name: 'tests',
    globs: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/test/**', '**/tests/**'],
    action: 'collapse',
  },
  {
    name: 'docs',
    globs: ['**/*.md', '**/*.mdx', 'docs/**'],
    action: 'hide',
  },
  {
    name: 'generated',
    globs: [
      '**/*.pb.go',
      '**/*.generated.*',
      '**/gen/**',
      '**/generated/**',
      '**/package-lock.json',
      '**/yarn.lock',
      '**/pnpm-lock.yaml',
      '**/go.sum',
      '**/Cargo.lock',
    ],
    action: 'hide',
  },
];

export interface PrImpactConfig {
  rules: CategoryRule[];
  /**
   * Categories that start expanded; every other category starts hidden.
   * Null when the config file doesn't set it - the per-category `action`
   * defaults rule then (built-in defaults already expand only `code`).
   */
  defaultView: string[] | null;
}

export const DEFAULT_CONFIG: PrImpactConfig = {rules: DEFAULT_CATEGORIES, defaultView: null};

const ACTIONS = new Set<CategoryAction>(['visible', 'collapse', 'hide']);

/**
 * Loose parser for `.github/pr-impact.yml`. Unknown keys are ignored; entries
 * without a non-empty string `globs` array are skipped. Throws when nothing
 * usable remains so the caller can fall back to the built-in defaults.
 */
export function parseConfig(text: string): PrImpactConfig {
  const data: unknown = parse(text);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('pr-impact.yml: root must be a mapping');
  }

  const {categories} = data as Record<string, unknown>;
  if (typeof categories !== 'object' || categories === null || Array.isArray(categories)) {
    throw new Error('pr-impact.yml: missing `categories` mapping');
  }

  const rules: CategoryRule[] = [];
  for (const [name, value] of Object.entries(categories)) {
    if (typeof value !== 'object' || value === null) {
      continue;
    }

    const {globs, action} = value as {globs?: unknown; action?: unknown};
    if (!Array.isArray(globs) || globs.length === 0 || !globs.every(glob => typeof glob === 'string')) {
      continue;
    }

    rules.push({
      name,
      globs: globs as string[],
      action: ACTIONS.has(action as CategoryAction) ? (action as CategoryAction) : 'visible',
    });
  }

  if (rules.length === 0) {
    throw new Error('pr-impact.yml: no valid categories');
  }

  const defaultViewRaw = (data as Record<string, unknown>).defaultView;
  const defaultView =
    Array.isArray(defaultViewRaw) && defaultViewRaw.length > 0 && defaultViewRaw.every(x => typeof x === 'string')
      ? (defaultViewRaw as string[])
      : null;

  return {rules, defaultView};
}

// Session-scoped cache, keyed by `owner/repo`; stores the promise so
// concurrent inits for the same repo share one fetch.
const cache = new Map<string, Promise<PrImpactConfig>>();

/** Fetches the repo config same-origin (session cookies → works for private repos). Fails open to defaults. */
export function fetchConfig(owner: string, repo: string): Promise<PrImpactConfig> {
  const key = `${owner}/${repo}`;
  let cached = cache.get(key);
  if (!cached) {
    cached = (async () => {
      try {
        const response = await fetch(`/${owner}/${repo}/raw/HEAD/.github/pr-impact.yml`, {
          credentials: 'include',
        });
        if (!response.ok) {
          return DEFAULT_CONFIG;
        }

        return parseConfig(await response.text());
      } catch {
        return DEFAULT_CONFIG;
      }
    })();
    cache.set(key, cached);
  }

  return cached;
}
