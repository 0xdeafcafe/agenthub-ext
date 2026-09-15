export const PR_PAGE_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/(files|changes)(?:\/.*)?)?\/?$/;

export const PR_NAV_SELECTOR =
  'nav[aria-label="Pull request navigation"], .tabnav-pr, #partial-discussion-header';

const navigation = (doc: Document): Element | null =>
  doc.querySelector('nav[aria-label="Pull request navigation"], .tabnav-pr') ??
  doc.querySelector('#partial-discussion-header');

export interface PrTotals {
  files: number;
  added: number;
  removed: number;
}

/** GitHub's own header totals are available before the full diff downloads. */
export function readPrTotals(doc: Document): PrTotals | null {
  const nav = navigation(doc);
  const link = [...(nav?.querySelectorAll('a[href]') ?? [])].find((anchor) =>
    /\/pull\/\d+\/(?:files|changes)(?:[/?#]|$)/.test(anchor.getAttribute('href') ?? ''),
  );
  const counter =
    link?.querySelector('[data-component="CounterLabel"], .Counter') ?? link?.querySelector('span');
  const filesText = counter?.textContent?.trim().replaceAll(',', '') ?? '';
  if (!/^\d+$/.test(filesText)) return null;
  const header =
    nav?.closest('header, #partial-discussion-header, .gh-header') ?? nav?.parentElement;
  for (const element of header?.querySelectorAll(
    '.sr-only, [class*="VisuallyHidden"], [aria-label]',
  ) ?? []) {
    const text = element.getAttribute('aria-label') ?? element.textContent ?? '';
    const lines = /(?:Lines changed:\s*)?([\d,]+) additions?\s*&\s*([\d,]+) deletions?/.exec(text);
    if (lines)
      return {
        files: Number(filesText),
        added: Number(lines[1].replaceAll(',', '')),
        removed: Number(lines[2].replaceAll(',', '')),
      };
  }
  return null;
}

/** Mount outside GitHub's scrolling/virtualized content, below the PR header. */
export function pullHeaderPlacement(): {parent: Element; before: Element | null} | null {
  const nav = navigation(document);
  if (!nav) return null;
  const header =
    nav.closest('header[class*="PageLayout-Header"], #partial-discussion-header, .gh-header') ??
    nav;
  const parent = header.parentElement;
  return parent ? {parent, before: header.nextElementSibling} : null;
}

/** GitHub anchors file diffs by the SHA-256 of their repository-relative path. */
export async function fileAnchor(path: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  return (
    '#diff-' + [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  );
}
