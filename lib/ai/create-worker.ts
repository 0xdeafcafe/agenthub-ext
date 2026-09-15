import {browser} from 'wxt/browser';
export function createModelWorker(): Worker {
  return new Worker(browser.runtime.getURL('/ai-worker.js'), {type: 'module'});
}
