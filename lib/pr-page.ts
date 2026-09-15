export const PR_PAGE_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/(files|changes)(?:\/.*)?)?\/?$/;

export const PR_NAV_SELECTOR =
  'nav[aria-label="Pull request navigation"], .tabnav-pr, #partial-discussion-header';

/** Mount outside GitHub's scrolling/virtualized content, below the PR header. */
export function pullHeaderPlacement(): {parent: Element; before: Element | null} | null {
  const nav = document.querySelector(PR_NAV_SELECTOR);
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
