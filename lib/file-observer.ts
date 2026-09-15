import {containerSelector, headerSelector, isFileContainer} from './views';
import {rafThrottled} from './safe';

const OWN_UI = '#prix-bar, .prix-file-controls, .prix-badge';

/** Reconcile mounted files by their current identity, including recycled DOM nodes. */
export function observeFiles(callback: (container: Element) => void, signal: AbortSignal): void {
  if (signal.aborted) return;
  const pending = new Set<Element>();
  const flush = rafThrottled(() => {
    const files = [...pending];
    pending.clear();
    for (const file of files) if (file.isConnected && isFileContainer(file)) callback(file);
  }, signal);
  const queue = (element: Element): void => {
    const container = element.closest(containerSelector);
    if (container) pending.add(container);
  };
  const scan = (element: Element): void => {
    if (element.matches(OWN_UI)) return;
    if (element.matches(containerSelector)) pending.add(element);
    for (const container of element.querySelectorAll(containerSelector)) pending.add(container);
    if (element.matches(headerSelector) || element.querySelector(headerSelector)) queue(element);
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target || target.closest(OWN_UI)) continue;
      if (record.type === 'childList') {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (nodes.length && nodes.every((node) => node instanceof Element && node.matches(OWN_UI)))
          continue;
        if (target.matches(containerSelector) || target.closest(headerSelector)) queue(target);
        for (const node of record.addedNodes) if (node instanceof Element) scan(node);
      } else if (record.type === 'attributes' || target.closest(headerSelector)) queue(target);
    }
    if (pending.size) flush();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['id', 'data-tagsearch-path', 'data-path', 'aria-label', 'aria-expanded'],
  });
  scan(document.documentElement);
  flush();
  signal.addEventListener(
    'abort',
    () => {
      observer.disconnect();
      pending.clear();
    },
    {once: true},
  );
}
