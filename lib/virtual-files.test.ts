// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {VirtualFiles, isVirtualFile} from './virtual-files';
import {outerFileWrapper} from './views';

afterEach(() => document.body.replaceChildren());
describe('virtualized file visibility', () => {
  it('waits for a trusted disclosure click to commit instead of toggling it twice', () => {
    document.body.innerHTML =
      '<div data-index="0"><div id="diff-aaaaaaaa"><div class="DiffFileHeader-module__diff-file-header"><button aria-label="Collapse file" aria-expanded="true">Collapse</button></div></div></div>';
    const container = document.querySelector('#diff-aaaaaaaa')!;
    const button = container.querySelector('button')!;
    let clicks = 0;
    button.addEventListener('click', () => clicks++);
    const controller = new AbortController();
    const files = new VirtualFiles(controller.signal);
    files.userToggle(container, false);
    files.apply(container, 'collapsed');
    expect(clicks).toBe(0);
    button.setAttribute('aria-expanded', 'false');
    files.apply(container, 'collapsed');
    controller.abort();
    expect(clicks).toBe(0);
  });
  it('uses the native disclosure, avoids repeated clicks, and restores it on disable', () => {
    document.body.innerHTML =
      '<main><div data-virtualizer style="height:5000px"><div data-index="8" style="position:absolute;height:800px;transform:translateY(1200px)"><div id="diff-aaaaaaaa"><div class="DiffFileHeader-module__diff-file-header"><button aria-label="Collapse file" aria-expanded="true">Collapse</button></div></div></div></div></main>';
    const container = document.querySelector('#diff-aaaaaaaa')!;
    const slot = container.parentElement!;
    const before = slot.getAttribute('style');
    const button = container.querySelector('button')!;
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks++;
      button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true'));
    });
    const controller = new AbortController();
    const files = new VirtualFiles(controller.signal);
    expect(isVirtualFile(container)).toBe(true);
    expect(outerFileWrapper(container)).toBe(container);
    files.apply(container, 'hidden');
    files.apply(container, 'hidden');
    expect(clicks).toBe(1);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(slot.getAttribute('style')).toBe(before);
    controller.abort();
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('leaves estimated skeleton and spacer geometry alone with only one mounted file', () => {
    document.body.innerHTML =
      '<main><div style="height:50000px"><div data-index="20" style="position:absolute;height:800px"><div id="diff-aaaaaaaa" aria-label="Loading package.json"></div></div></div></main>';
    const container = document.querySelector('#diff-aaaaaaaa')!;
    const before = document.body.innerHTML;
    const controller = new AbortController();
    new VirtualFiles(controller.signal).apply(container, 'hidden');
    expect(outerFileWrapper(container)).toBe(container);
    expect(document.body.innerHTML).toBe(before);
    controller.abort();
  });
});
