// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {watchPullsMenu} from './pulls-menu';

const menu = (): HTMLElement | null => document.querySelector('.prix-pulls-menu');
const hover = (target: Element, relatedTarget: Element | null = null): void => {
  target.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, relatedTarget}));
};
const leave = (target: Element, relatedTarget: Element | null): void => {
  target.dispatchEvent(new MouseEvent('mouseout', {bubbles: true, relatedTarget}));
};
const key = (target: Element, name: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', {key: name, bubbles: true}));
};

describe('watchPullsMenu', () => {
  let controller: AbortController;
  let tab: HTMLAnchorElement;
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/o/r/pulls?q=is%3Apr+author%3Aoctocat');
    document.head.innerHTML = '<meta name="user-login" content="octocat">';
    document.body.innerHTML =
      '<nav aria-label="Repository"><ul><li><a id="pull-requests-tab" href="/o/r/pulls"><span>Pull requests</span></a></li></ul></nav><main>page</main>';
    tab = document.querySelector('a')!;
    controller = new AbortController();
    watchPullsMenu(controller.signal);
  });
  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it('opens on hover after a short delay, with the current view marked', () => {
    hover(tab.querySelector('span')!);
    expect(menu()).toBeNull();
    vi.advanceTimersByTime(150);
    expect([...menu()!.querySelectorAll('a')].map((link) => link.textContent)).toEqual([
      'Pull requests',
      'Authored by me',
      'Assigned to me',
      'Involves me',
      'Review requests',
      'Milestones',
      'Labels',
    ]);
    expect(menu()!.querySelector('[aria-current="page"]')?.textContent).toBe('Authored by me');
    expect(menu()!.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(tab.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('nav li')).toHaveLength(1);
  });

  it('stays open while moving into the menu and closes after leaving both', () => {
    hover(tab);
    vi.advanceTimersByTime(150);
    const first = menu()!.querySelector('a')!;
    leave(tab, first);
    hover(first);
    vi.advanceTimersByTime(500);
    expect(menu()).not.toBeNull();
    leave(first, document.querySelector('main'));
    vi.advanceTimersByTime(250);
    expect(menu()).toBeNull();
    expect(tab.hasAttribute('aria-expanded')).toBe(false);
  });

  it('does not open when the pointer only passes over the tab', () => {
    hover(tab);
    leave(tab, document.querySelector('main'));
    vi.advanceTimersByTime(500);
    expect(menu()).toBeNull();
  });

  it('works from the keyboard and hands focus back on Escape', () => {
    tab.focus();
    key(tab, 'ArrowDown');
    const links = [...menu()!.querySelectorAll('a')];
    expect(document.activeElement).toBe(links[0]);
    key(links[0], 'ArrowUp');
    expect(document.activeElement).toBe(links.at(-1));
    key(links.at(-1)!, 'Escape');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(tab);
  });

  it('removes itself when the page tears the feature down', () => {
    tab.focus();
    key(tab, 'ArrowDown');
    controller.abort();
    expect(menu()).toBeNull();
    hover(tab);
    vi.advanceTimersByTime(500);
    expect(menu()).toBeNull();
  });
});
