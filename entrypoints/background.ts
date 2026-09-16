import {defineBackground} from 'wxt/utils/define-background';
import {browser} from 'wxt/browser';
import {diffPathForPage} from '../lib/diff';
import {readDiffResponse} from '../lib/inventory';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'prix:inventory' && message?.type !== 'prix:settings') return;
    // The page can request only its own PR/range, never an arbitrary URL.
    const source = sender.url ? new URL(sender.url) : null;
    if (message.type === 'prix:settings') {
      if (!source || source.origin !== 'https://github.com') {
        sendResponse({opened: false});
        return;
      }
      const repo = source.pathname.split('/').slice(1, 3).join('/');
      void browser.tabs
        .create({url: browser.runtime.getURL('/popup.html') + `?repo=${encodeURIComponent(repo)}`})
        .then(
          () => sendResponse({opened: true}),
          () => sendResponse({opened: false}),
        );
      return true;
    }
    if (
      !source ||
      source.origin !== 'https://github.com' ||
      diffPathForPage(source) !== message.path
    ) {
      sendResponse({inventory: null});
      return;
    }
    void (async () => {
      try {
        const response = await fetch(`https://github.com${message.path}`, {
          credentials: 'include',
          signal: AbortSignal.timeout(15000),
        });
        sendResponse({inventory: await readDiffResponse(response)});
      } catch {
        sendResponse({inventory: null});
      }
    })();
    return true;
  });
});
