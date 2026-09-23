import {describe, expect, it} from 'vitest';
import {activeMenuItem, pullsMenuItems} from './pulls-menu';

const query = (href: string): string | null =>
  new URL(href, 'https://github.com').searchParams.get('q');

describe('pullsMenuItems', () => {
  it('matches GitHub’s sidebar when signed in', () => {
    const items = pullsMenuItems('o', 'r', 'octocat');
    expect(items.map((item) => item.label)).toEqual([
      'Pull requests',
      'Authored by me',
      'Assigned to me',
      'Involves me',
      'Review requests',
      'Milestones',
      'Labels',
    ]);
    expect(items.map((item) => query(item.href))).toEqual([
      null,
      'is:pr is:open author:octocat',
      'is:pr is:open assignee:octocat',
      'is:pr is:open involves:octocat',
      'is:pr is:open review-requested:octocat',
      null,
      null,
    ]);
    expect(items.find((item) => item.group)?.label).toBe('Milestones');
    expect(items.at(-1)?.href).toBe('/o/r/labels');
  });

  it('leaves out the personal views when signed out', () => {
    expect(pullsMenuItems('o', 'r', null).map((item) => item.label)).toEqual([
      'Pull requests',
      'Milestones',
      'Labels',
    ]);
  });
});

describe('activeMenuItem', () => {
  const active = (pathname: string, search = '', login: string | null = 'octocat') =>
    activeMenuItem('o', 'r', login, pathname, search);

  it('marks the plain list and filtered lists without a personal qualifier', () => {
    expect(active('/o/r/pulls')).toBe('all');
    expect(active('/o/r/pulls/', '?q=is:pr+is:closed')).toBe('all');
  });

  it('matches personal qualifiers by login or @me, as whole tokens', () => {
    expect(active('/o/r/pulls', '?q=is:pr+author:OctoCat')).toBe('authored');
    expect(active('/o/r/pulls', '?q=assignee:@me')).toBe('assigned');
    expect(active('/o/r/pulls', '?q=is:open+involves:octocat')).toBe('involves');
    expect(active('/o/r/pulls', '?q=review-requested%3A%40me')).toBe('review');
    expect(active('/o/r/pulls', '?q=author:octocat2')).toBe('all');
    expect(active('/o/r/pulls', '?q=xauthor:@me')).toBe('all');
  });

  it('follows GitHub’s @me redirects only when signed in', () => {
    expect(active('/o/r/pulls/@me')).toBe('authored');
    expect(active('/o/r/pulls/review-requested/@me')).toBe('review');
    expect(active('/o/r/pulls/@me', '', null)).toBeNull();
  });

  it('marks milestones and labels, and nothing elsewhere', () => {
    expect(active('/o/r/milestones')).toBe('milestones');
    expect(active('/o/r/milestone/3')).toBe('milestones');
    expect(active('/o/r/labels')).toBe('labels');
    expect(active('/o/r/pull/42')).toBeNull();
    expect(active('/o/other/pulls')).toBeNull();
  });
});
