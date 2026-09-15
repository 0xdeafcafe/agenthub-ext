import {h} from 'dom-chef';

/** Small dimmed category label appended to a file header. Idempotent. */
export function injectBadge(header: Element, category: string): void {
  const existing = header.querySelector('.prix-badge');
  if (existing) {
    if (existing.textContent !== category) existing.textContent = category;
    return;
  }

  header.append(<span className="prix-badge">{category}</span>);
}
