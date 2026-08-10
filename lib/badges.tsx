import {h} from 'dom-chef';

/** Small dimmed category label appended to a file header. Idempotent. */
export function injectBadge(header: Element, category: string): void {
  if (header.querySelector('.prix-badge')) {
    return;
  }

  header.append(<span className="prix-badge">{category}</span>);
}
