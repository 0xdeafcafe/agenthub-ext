import {parse} from 'yaml';
import type {CategoryAction, CategoryRule} from './classifier';
import {fetchGitattributesGlobs} from './gitattributes';
import {readCachedFile, writeCachedFile} from './repo-file-cache';

export const DEFAULT_CATEGORIES: CategoryRule[] = [
  {
    name: 'tests',
    globs: [
      '**/*.test.*',
      '**/*.spec.*',
      '**/*_test.*',
      '**/__tests__/**',
      '**/test/**',
      '**/tests/**',
    ],
    action: 'collapse',
  },
  {
    // Gherkin specs - not tests as far as CI is concerned, but never code either
    name: 'specs',
    globs: ['**/*.feature'],
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
    if (
      !Array.isArray(globs) ||
      globs.length === 0 ||
      !globs.every((glob) => typeof glob === 'string')
    ) {
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
    Array.isArray(defaultViewRaw) &&
    defaultViewRaw.length > 0 &&
    defaultViewRaw.every((x) => typeof x === 'string')
      ? (defaultViewRaw as string[])
      : null;

  return {rules, defaultView};
}

/**
 * Folds paths GitHub itself treats as generated (`.gitattributes`,
 * `linguist-generated=true`) into the `generated` category, so repos get
 * that detection for free without writing `.github/pr-impact.yml`. Leaves
 * the config untouched if it has no `generated` category - a repo that
 * renamed or dropped it made that call on purpose.
 */
export function withGitattributesGenerated(
  config: PrImpactConfig,
  globs: string[],
): PrImpactConfig {
  if (globs.length === 0) return config;
  const index = config.rules.findIndex((rule) => rule.name === 'generated');
  if (index === -1) return config;

  const rule = config.rules[index];
  const merged = [...new Set([...rule.globs, ...globs])];
  if (merged.length === rule.globs.length) return config;

  const rules = [...config.rules];
  rules[index] = {...rule, globs: merged};
  return {...config, rules};
}

// Session-scoped cache, keyed by `owner/repo@ref`; stores the promise so
// concurrent inits for the same repo share one fetch.
const cache = new Map<string, Promise<PrImpactConfig>>();

/**
 * Fetches and parses `pr-impact.yml` at one exact ref. Null when absent or
 * unparseable. Checks the persistent cache first - re-fetching this on
 * every PR visit was the main source of slow detection.
 */
async function fetchYamlAt(
  owner: string,
  repo: string,
  ref: string,
): Promise<PrImpactConfig | null> {
  const path = '.github/pr-impact.yml';
  const stored = await readCachedFile(owner, repo, ref, path);
  if (stored !== null) {
    try {
      return stored ? parseConfig(stored) : null;
    } catch {
      return null;
    }
  }

  try {
    const response = await fetch(`/${owner}/${repo}/raw/${ref}/${path}`, {
      signal: AbortSignal.timeout(4000),
    });
    const text = response.ok ? await response.text() : '';
    void writeCachedFile(owner, repo, ref, path, text);
    return text ? parseConfig(text) : null;
  } catch {
    return null;
  }
}

/**
 * Fetches the repo config same-origin (session cookies → works for private
 * repos), from `ref` (the PR's own head commit, so a config or
 * `.gitattributes` change lands the moment its PR opens rather than after it
 * merges), falling back to the default branch, then to built-in defaults.
 *
 * `ref` is scraped from the page best-effort and can lag the true PR head;
 * falling back to the default branch rather than straight to defaults means
 * a stale `ref` degrades to "acts like the file wasn't in this PR yet", not
 * to ignoring a config that's been live on the default branch all along.
 *
 * Public repos serve this via a redirect to raw.githubusercontent.com, whose
 * wildcard CORS header rejects a credentialed request outright - default
 * (same-origin) credentials avoid that while still carrying the session
 * cookie on the github.com leg.
 */
export function fetchConfig(owner: string, repo: string, ref: string): Promise<PrImpactConfig> {
  const key = `${owner}/${repo}@${ref}`;
  let cached = cache.get(key);
  if (!cached) {
    cached = (async () => {
      const [config, generatedGlobs] = await Promise.all([
        (async () => {
          const atRef = await fetchYamlAt(owner, repo, ref);
          if (atRef) return atRef;
          if (ref !== 'HEAD') {
            const atDefault = await fetchYamlAt(owner, repo, 'HEAD');
            if (atDefault) return atDefault;
          }
          return DEFAULT_CONFIG;
        })(),
        fetchGitattributesGlobs(owner, repo, ref),
      ]);

      return withGitattributesGenerated(config, generatedGlobs);
    })();
    cache.set(key, cached);
  }

  return cached;
}
