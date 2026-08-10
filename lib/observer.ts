/**
 * Persistent selector-observer: runs `callback` exactly once per element
 * matching `selector`, for elements already in the DOM and for elements
 * mounted later (GitHub mounts diff files lazily on scroll). Disconnects
 * when `signal` aborts (soft navigation teardown).
 */
export function observeSelector(
  selector: string,
  callback: (element: Element) => void,
  signal: AbortSignal,
): void {
  const visit = (element: Element): void => {
    // data attribute guard (rather than a WeakSet) so re-scans across
    // observer restarts on the same page don't double-process
    if (element.hasAttribute('data-prix-seen')) {
      return;
    }

    element.setAttribute('data-prix-seen', '');
    callback(element);
  };

  const scan = (root: ParentNode): void => {
    for (const element of root.querySelectorAll(selector)) {
      visit(element);
    }
  };

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) {
          continue;
        }

        if (node.matches(selector)) {
          visit(node);
        }

        scan(node);
      }
    }
  });

  // documentElement exists even at document_start; body may not yet
  scan(document.documentElement);
  observer.observe(document.documentElement, {childList: true, subtree: true});
  signal.addEventListener('abort', () => {
    observer.disconnect();
  }, {once: true});
}
