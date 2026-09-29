import {readCachedFile, writeCachedFile} from './repo-file-cache';

/**
 * GitHub already asks repos to flag generated files via `.gitattributes`
 * (`path linguist-generated=true`) so its own diff view can collapse them.
 * We read the same file so the `generated` category picks up those paths
 * without every repo needing a `.github/pr-impact.yml` too.
 */

function toGlob(pattern: string): string {
  const rooted = pattern.startsWith('/');
  const trimmed = rooted ? pattern.slice(1) : pattern;
  if (trimmed.endsWith('/')) return `${trimmed}**`;
  return rooted || trimmed.includes('/') ? trimmed : `**/${trimmed}`;
}

/** Loose parser: one pattern per line, followed by whitespace-separated attributes. */
export function parseGeneratedGlobs(text: string): string[] {
  const globs = new Set<string>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const [pattern, ...attrs] = line.split(/\s+/);
    if (!pattern) continue;
    const generated = attrs.some(
      (attr) => attr === 'linguist-generated' || attr === 'linguist-generated=true',
    );
    if (generated) globs.add(toGlob(pattern));
  }

  return [...globs];
}

// In-memory, per-page-load dedup for concurrent calls; repo-file-cache.ts
// underneath persists the actual fetched text across page loads.
const cache = new Map<string, Promise<string[]>>();

/**
 * Fetches `.gitattributes` same-origin, from a single exact ref. Fails open
 * to no globs. Checks the persistent cache first - re-fetching this on
 * every PR visit was the main source of slow detection.
 *
 * Public repos serve this via a 302 to raw.githubusercontent.com, which
 * answers with `Access-Control-Allow-Origin: *` - incompatible with a
 * credentialed request, so `fetch` throws and we'd silently get nothing.
 * Default (same-origin) credentials still carry the session cookie on the
 * github.com leg, which is all private repos need.
 */
function fetchGlobsAt(owner: string, repo: string, ref: string): Promise<string[]> {
  const key = `${owner}/${repo}@${ref}`;
  let cached = cache.get(key);
  if (!cached) {
    cached = (async () => {
      const stored = await readCachedFile(owner, repo, ref, '.gitattributes');
      if (stored !== null) return parseGeneratedGlobs(stored);

      try {
        const response = await fetch(`/${owner}/${repo}/raw/${ref}/.gitattributes`, {
          signal: AbortSignal.timeout(4000),
        });
        const text = response.ok ? await response.text() : '';
        void writeCachedFile(owner, repo, ref, '.gitattributes', text);
        return parseGeneratedGlobs(text);
      } catch {
        return [];
      }
    })();
    cache.set(key, cached);
  }

  return cached;
}

/**
 * Fetches `.gitattributes` generated-file globs, unioning `ref` (the PR's
 * own head commit, so a change lands the moment its PR opens) with the
 * default branch. `ref` is scraped from the page best-effort and can lag
 * the true head (e.g. a stale commit reference elsewhere on the page); the
 * union means that can only ever miss a PR-only addition, never a marker
 * that already exists on the default branch.
 */
export function fetchGitattributesGlobs(
  owner: string,
  repo: string,
  ref: string,
): Promise<string[]> {
  if (ref === 'HEAD') return fetchGlobsAt(owner, repo, 'HEAD');

  return Promise.all([fetchGlobsAt(owner, repo, ref), fetchGlobsAt(owner, repo, 'HEAD')]).then(
    ([atRef, atDefault]) => [...new Set([...atRef, ...atDefault])],
  );
}
