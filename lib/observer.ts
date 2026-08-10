/**
 * Persistent selector-observer: runs `callback` exactly once per element
 * matching `selector`, for elements already in the DOM and for elements
 * mounted later (GitHub mounts diff files lazily on scroll). Disconnects
 * when `signal` aborts (soft navigation teardown).
 *
 * Hardening: callback exceptions are logged and swallowed (one bad element
 * must not kill the observer), and a scan bails loudly if the selector ever
 * matches an absurd number of nodes (over-match guard against GitHub DOM
 * changes turning a file selector into a page-level one).
 */
export function observeSelector(
  selector: string,
  callback: (element: Element) => void,
  signal: AbortSignal,
): void {
  const MAX_MATCHES = 5000;
  const visit = (element: Element): void => {
    // data attribute guard (rather than a WeakSet) so re-scans across
    // observer restarts on the same page don't double-process
    if (element.hasAttribute('data-prix-seen')) {
      return;
    }

    element.setAttribute('data-prix-seen', '');
    try {
      callback(element);
    } catch (error) {
      console.error('[PR Impact]', 'observer callback', error);
    }
  };

  const scan = (root: ParentNode): void => {
    const matches = root.querySelectorAll(selector);
    if (matches.length > MAX_MATCHES) {
      console.error('[PR Impact]', `selector "${selector}" matched ${matches.length} nodes - refusing to process`);
      return;
    }

    for (const element of matches) {
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
