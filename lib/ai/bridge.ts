import {browser} from 'wxt/browser';
import {diffPathForPage} from '../diff';
import {readDiffText} from '../inventory';
import {fileAnchor} from '../pr-page';
import {indexPatch, type SourceIndex} from './index';
import {rafThrottled} from '../safe';

/** Model UI runs on the extension origin, outside GitHub's virtualized layout. */
export function installAssistant(
  signal: AbortSignal,
  openFile: (path: string) => void,
  scope: () => string,
  categoryOf: (path: string) => string,
): void {
  const launch = document.createElement('button');
  launch.id = 'prix-ai-launch';
  launch.type = 'button';
  launch.textContent = '✦ Ask this PR';
  launch.setAttribute('aria-expanded', 'false');
  launch.setAttribute('aria-controls', 'prix-ai-panel');
  const panel = document.createElement('aside');
  panel.id = 'prix-ai-panel';
  panel.setAttribute('aria-label', 'Local PR assistant');
  panel.hidden = true;
  let frame: HTMLIFrameElement | null = null;
  let controller: AbortController | null = null;
  let index: SourceIndex | null = null;
  let loading = false;
  let channel = '';
  let targetOrigin = '';
  let ready = false;
  let lastTheme = '';
  const theme = (): string => {
    const root = document.documentElement;
    return root.dataset.colorMode === 'dark' ||
      (root.dataset.darkTheme &&
        root.dataset.colorMode === 'auto' &&
        matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark'
      : 'light';
  };
  const send = (data: Record<string, unknown>): void => {
    if (ready) frame?.contentWindow?.postMessage({channel, ...data}, targetOrigin);
  };
  const close = (): void => {
    send({type: 'suspend'});
    panel.hidden = true;
    launch.setAttribute('aria-expanded', 'false');
    launch.focus({preventScroll: true});
  };
  const dispose = (): void => {
    controller?.abort();
    frame?.remove();
    frame = null;
    index = null;
    loading = false;
    ready = false;
    panel.hidden = true;
    launch.setAttribute('aria-expanded', 'false');
    launch.focus({preventScroll: true});
  };
  const load = async (): Promise<void> => {
    if (loading || !controller) return;
    const request = controller;
    loading = true;
    send({type: 'loading'});
    try {
      const path = diffPathForPage(new URL(location.href));
      if (!path)
        throw new Error(
          'Use the full diff or a commit range. This comparison cannot be indexed yet.',
        );
      let result: SourceIndex;
      if (browser.runtime.id === 'prix-local-preview')
        result = await indexPatch(await readDiffText(await fetch(path, {signal: request.signal})));
      else {
        const response = await browser.runtime.sendMessage({type: 'prix:ai-index', path});
        if (!response?.index)
          throw new Error(response?.error ?? 'The complete diff is unavailable. Try again.');
        result = response.index as SourceIndex;
      }
      if (request.signal.aborted) return;
      for (const file of result.files) file.category = categoryOf(file.path);
      for (const chunk of result.chunks) chunk.category = categoryOf(chunk.path);
      index = result;
      send({
        type: 'context',
        index,
        scope: scope(),
        title: document.title.replace(/ · GitHub$/, ''),
        page: location.pathname,
        theme: theme(),
      });
    } catch (error) {
      if (!request.signal.aborted)
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'Could not load this diff.',
        });
    } finally {
      if (request === controller) loading = false;
    }
  };
  launch.addEventListener('click', () => {
    if (frame) {
      if (panel.hidden) {
        panel.hidden = false;
        launch.setAttribute('aria-expanded', 'true');
        send({type: 'resume'});
      } else close();
      return;
    }
    channel = crypto.randomUUID();
    controller = new AbortController();
    const url = new URL(browser.runtime.getURL('/assistant.html'));
    // Extension iframes can have an empty document.referrer.
    url.searchParams.set('parentOrigin', location.origin);
    url.hash = channel;
    targetOrigin = url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin;
    frame = document.createElement('iframe');
    frame.title = 'Ask this PR locally';
    frame.src = url.href;
    frame.allow = 'clipboard-write';
    panel.replaceChildren(frame);
    panel.hidden = false;
    launch.setAttribute('aria-expanded', 'true');
  });
  window.addEventListener(
    'message',
    (event: MessageEvent) => {
      if (
        !frame ||
        event.source !== frame.contentWindow ||
        event.origin !== targetOrigin ||
        event.data?.channel !== channel
      )
        return;
      if (event.data.type === 'ready') {
        ready = true;
        void load();
      } else if (event.data.type === 'refresh') void load();
      else if (event.data.type === 'close') close();
      else if (event.data.type === 'open-source') {
        const source = index?.chunks.find((chunk) => chunk.id === event.data.id);
        if (!source) return;
        openFile(source.path);
        const request = controller;
        void fileAnchor(source.path)
          .then((anchor) => {
            if (!request?.signal.aborted)
              location.hash = `${anchor}${source.added ? 'R' + source.newStart : 'L' + source.oldStart}`;
          })
          .catch(() => {});
      }
    },
    {signal},
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && frame) close();
    },
    {signal},
  );
  const mount = rafThrottled(() => {
    if (!document.body) return;
    if (!launch.isConnected) document.body.append(launch, panel);
    if (frame && lastTheme !== theme()) {
      lastTheme = theme();
      send({type: 'theme', theme: lastTheme});
    }
  }, signal);
  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-color-mode', 'data-dark-theme'],
  });
  signal.addEventListener(
    'abort',
    () => {
      dispose();
      launch.remove();
      panel.remove();
      observer.disconnect();
    },
    {once: true},
  );
  mount();
}
