import {defineBackground} from 'wxt/utils/define-background';
import {browser} from 'wxt/browser';
import {diffPathForPage} from '../lib/diff';
import {readDiffResponse, readDiffText} from '../lib/inventory';
import {indexPatch} from '../lib/ai/index';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!['prix:inventory', 'prix:settings', 'prix:ai-index'].includes(message?.type)) return;
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
        if (message.type === 'prix:ai-index')
          sendResponse({index: await indexPatch(await readDiffText(response))});
        else sendResponse({inventory: await readDiffResponse(response)});
      } catch (error) {
        sendResponse({
          inventory: null,
          error: error instanceof Error ? error.message : 'Could not load the diff.',
        });
      }
    })();
    return true;
  });
});
