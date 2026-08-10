/**
 * Parser for Language's "PR Impact Map" bot comment (posted by
 * github-actions[bot] on langwatch/langwatch PRs). Real format, captured in
 * lib/__fixtures__/:
 *
 *   PR Impact Map · 7 files · +368 / -315 · 8ecd2b6
 *   -----------------------------------------------
 *
 *     Category        Files      Added   Removed   Share
 *     --------------------------------------------------------------
 *     Deps                3       +339      -307   ██████░░░░░░░░░  43%
 *     ...
 *     --------------------------------------------------------------
 *     Total               7       +368      -315
 *
 * The chart is aggregate-only (no file→category mapping), so it can never
 * drive classification - we use its category names/percentages as display
 * data alongside our glob-based counts.
 */

export interface ImpactMapCategory {
  name: string;
  files: number;
  added: number;
  removed: number;
  /** 0–100 */
  share: number;
}

export interface ImpactMap {
  categories: ImpactMapCategory[];
  totalFiles: number;
  totalAdded: number;
  totalRemoved: number;
  commit: string | null;
}

const HEADER_RE = /^PR Impact Map · [\d,]+ files? · \+[\d,]+ \/ -[\d,]+ · ([0-9a-f]{7,})/;
const ROW_RE = /^\s*(.+?)\s{2,}(\d+)\s+\+([\d,]+)\s+-([\d,]+)\s+[█░]+\s+(\d{1,3})%\s*$/;
const TOTAL_RE = /^\s*Total\s{2,}(\d+)\s+\+([\d,]+)\s+-([\d,]+)\s*$/;

const toInt = (text: string): number => Number(text.replaceAll(',', ''));

export function parseImpactMap(text: string): ImpactMap | null {
  const lines = text.split('\n');
  const header = HEADER_RE.exec(lines[0]?.trim() ?? '');
  if (!header) {
    return null;
  }

  const categories: ImpactMapCategory[] = [];
  let total: {files: number; added: number; removed: number} | null = null;
  for (const line of lines.slice(1)) {
    const row = ROW_RE.exec(line);
    if (row) {
      categories.push({
        name: row[1].trim(),
        files: toInt(row[2]),
        added: toInt(row[3]),
        removed: toInt(row[4]),
        share: Number(row[5]),
      });
      continue;
    }

    const totalRow = TOTAL_RE.exec(line);
    if (totalRow) {
      total = {files: toInt(totalRow[1]), added: toInt(totalRow[2]), removed: toInt(totalRow[3])};
    }
  }

  if (categories.length === 0 || !total) {
    return null;
  }

  return {
    categories,
    totalFiles: total.files,
    totalAdded: total.added,
    totalRemoved: total.removed,
    commit: header[1],
  };
}

/** Pulls the raw chart text out of a parsed PR conversation page. */
export function extractImpactMapText(doc: Document): string | null {
  // GitHub wraps code blocks in a clipboard div carrying the raw text
  for (const el of doc.querySelectorAll('[data-snippet-clipboard-copy-content]')) {
    const content = el.getAttribute('data-snippet-clipboard-copy-content') ?? '';
    if (content.startsWith('PR Impact Map')) {
      return content;
    }
  }

  // Fallback: heading + code block
  for (const heading of doc.querySelectorAll('.js-comment-body h1, .js-comment-body h2, .js-comment-body h3')) {
    if (heading.textContent?.trim() === 'PR Impact Map') {
      const code = heading.parentElement?.querySelector('pre code');
      if (code?.textContent) {
        return code.textContent;
      }
    }
  }

  return null;
}

// In-memory session cache, one fetch per PR
const cache = new Map<string, Promise<ImpactMap | null>>();

/** Fetches and parses the PR conversation page. Fails open to null. */
export function fetchImpactMap(owner: string, repo: string, prNumber: string): Promise<ImpactMap | null> {
  const key = `${owner}/${repo}#${prNumber}`;
  let cached = cache.get(key);
  if (!cached) {
    cached = (async () => {
      try {
        const response = await fetch(`/${owner}/${repo}/pull/${prNumber}`, {credentials: 'include'});
        if (!response.ok) {
          return null;
        }

        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const text = extractImpactMapText(doc);
        return text ? parseImpactMap(text) : null;
      } catch {
        return null;
      }
    })();
    cache.set(key, cached);
  }

  return cached;
}

/** Markdown table for the clipboard. Uses Language chart rows when given, else our own counts. */
export function buildMarkdownReport(
  rows: Array<{name: string; files: number; added: number; removed: number; share: number}>,
): string {
  const lines = [
    '| Category | Files | Added | Removed | Share |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...rows.map(
      row => `| ${row.name} | ${row.files} | +${row.added} | -${row.removed} | ${Math.round(row.share)}% |`,
    ),
  ];
  return lines.join('\n');
}
