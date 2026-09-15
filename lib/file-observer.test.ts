// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {observeFiles} from './file-observer';
import {adapters} from './views';

let controller = new AbortController();
afterEach(() => {
  controller.abort();
  controller = new AbortController();
  document.body.replaceChildren();
});

describe('recycled file observation', () => {
  it('reconciles a reused container and header when its path changes', async () => {
    document.body.innerHTML =
      '<div id="diff-aaaaaaaa"><div class="DiffFileHeader-module__diff-file-header"><h3 class="DiffFileHeader-module__file-name"><code>tests/a.test.ts</code></h3></div></div>';
    const paths: Array<string | null> = [];
    observeFiles((file) => paths.push(adapters[1].getPath(file)), controller.signal);
    await vi.waitFor(() => expect(paths).toEqual(['tests/a.test.ts']));
    document.querySelector('code')!.textContent = 'src/b.ts';
    document.querySelector('div')!.id = 'diff-bbbbbbbb';
    await vi.waitFor(() => expect(paths).toEqual(['tests/a.test.ts', 'src/b.ts']));
    const file = document.querySelector('div')!;
    file.remove();
    document.body.append(file);
    await vi.waitFor(() => expect(paths).toHaveLength(3));
  });

  it('ignores injected controls and cancels pending work after navigation', async () => {
    document.body.innerHTML =
      '<div id="diff-aaaaaaaa"><div class="DiffFileHeader-module__diff-file-header"></div></div>';
    const visit = vi.fn<(file: Element) => void>();
    observeFiles(visit, controller.signal);
    await vi.waitFor(() => expect(visit).toHaveBeenCalledTimes(1));
    const badge = document.createElement('span');
    badge.className = 'prix-badge';
    document.querySelector('.DiffFileHeader-module__diff-file-header')!.append(badge);
    badge.textContent = 'code';
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(visit).toHaveBeenCalledTimes(1);
    document.querySelector('div')!.id = 'diff-bbbbbbbb';
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(visit).toHaveBeenCalledTimes(1);
  });
});
