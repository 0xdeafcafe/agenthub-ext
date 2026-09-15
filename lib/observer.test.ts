// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {observeSelector} from './observer';

const controllers: AbortController[] = [];
const signal = (): AbortSignal => {
  const controller = new AbortController();
  controllers.push(controller);
  return controller.signal;
};
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.abort());
  document.body.replaceChildren();
});
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('observeSelector', () => {
  it('processes initial nodes and late mounts once per observer', async () => {
    document.body.innerHTML = '<div class="file"></div>';
    const visit = vi.fn<(element: Element) => void>();
    observeSelector('.file', visit, signal());
    document.body.insertAdjacentHTML(
      'beforeend',
      '<section><div class="file"><span></span></div></section>',
    );
    await flush();
    expect(visit).toHaveBeenCalledTimes(2);
    document.querySelector('.file')!.append(document.createElement('span'));
    await flush();
    expect(visit).toHaveBeenCalledTimes(2);
  });

  it('reprocesses Turbo snapshots and clones carrying old seen markers', async () => {
    document.body.innerHTML = '<div class="file" data-prix-seen></div>';
    const first = vi.fn<(element: Element) => void>();
    observeSelector('.file', first, signal());
    controllers[0].abort();
    const second = vi.fn<(element: Element) => void>();
    observeSelector('.file', second, signal());
    document.body.append(document.querySelector('.file')!.cloneNode(true));
    await flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('does no work after navigation or when already aborted', async () => {
    const visit = vi.fn<(element: Element) => void>();
    observeSelector('.file', visit, signal());
    controllers[0].abort();
    document.body.innerHTML = '<div class="file"></div>';
    observeSelector('.file', visit, controllers[0].signal);
    await flush();
    expect(visit).not.toHaveBeenCalled();
  });
});
