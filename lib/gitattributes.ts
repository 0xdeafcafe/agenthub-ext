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

// Session-scoped cache, keyed by `owner/repo@ref`; mirrors fetchConfig's cache.
const cache = new Map<string, Promise<string[]>>();

/**
 * Fetches `.gitattributes` same-origin, from `ref` (the PR's own head commit,
 * so a `.gitattributes` change lands the moment its PR opens rather than
 * after it merges). Fails open to no globs.
 *
 * Public repos serve this via a 302 to raw.githubusercontent.com, which
 * answers with `Access-Control-Allow-Origin: *` - incompatible with a
 * credentialed request, so `fetch` throws and we'd silently get nothing.
 * Default (same-origin) credentials still carry the session cookie on the
 * github.com leg, which is all private repos need.
 */
export function fetchGitattributesGlobs(
  owner: string,
  repo: string,
  ref: string,
): Promise<string[]> {
  const key = `${owner}/${repo}@${ref}`;
  let cached = cache.get(key);
  if (!cached) {
    cached = (async () => {
      try {
        const response = await fetch(`/${owner}/${repo}/raw/${ref}/.gitattributes`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) return [];

        return parseGeneratedGlobs(await response.text());
      } catch {
        return [];
      }
    })();
    cache.set(key, cached);
  }

  return cached;
}
