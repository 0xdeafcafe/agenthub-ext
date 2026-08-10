import {describe, expect, it} from 'vitest';
import {buildMyPrsHref, extractSearchQuery, extractUserLogin, isMyPrsUrl, parseOpenPullsCount} from './my-prs-tab';

describe('buildMyPrsHref', () => {
  it('builds a properly URL-encoded pulls URL', () => {
    expect(buildMyPrsHref('octocat', 'hello-world')).toBe(
      '/octocat/hello-world/pulls?q=is%3Apr+is%3Aopen+author%3A%40me',
    );
  });

  it('round-trips through URLSearchParams decoding', () => {
    const [, search] = buildMyPrsHref('octocat', 'hello-world').split('?');
    expect(new URLSearchParams(search).get('q')).toBe('is:pr is:open author:@me');
  });
});

describe('isMyPrsUrl', () => {
  it('matches the repo pulls page with author:@me in q', () => {
    expect(isMyPrsUrl('o', 'r', '/o/r/pulls', '?q=is%3Apr+is%3Aopen+author%3A%40me')).toBe(true);
    expect(isMyPrsUrl('o', 'r', '/o/r/pulls', '?q=is:pr+is:open+author:@me')).toBe(true);
    expect(isMyPrsUrl('o', 'r', '/o/r/pulls', '?q=author:@me')).toBe(true);
    expect(isMyPrsUrl('o', 'r', '/o/r/pulls', '?q=is:open+author:@me+sort:updated-desc')).toBe(true);
  });

  it('tolerates a trailing slash on the path', () => {
    expect(isMyPrsUrl('o', 'r', '/o/r/pulls/', '?q=author:@me')).toBe(true);
  });

  it('rejects other pages even with author:@me in q', () => {
    expect(isMyPrsUrl('o', 'r', '/o/r/issues', '?q=author:@me')).toBe(false);
    expect(isMyPrsUrl('o', 'r', '/o/r/pulls/123', '?q=author:@me')).toBe(false);
    expect(isMyPrsUrl('o', 'r', '/o/r', '?q=author:@me')).toBe(false);
  });

  it('rejects other repos', () => {
    expect(isMyPrsUrl('o', 'r', '/o/other/pulls', '?q=author:@me')).toBe(false);
    expect(isMyPrsUrl('o', 'r', '/other/r/pulls', '?q=author:@me')).toBe(false);
  });

  it('rejects author:@me as a substring of another token', () => {
    expect(isMyPrsUrl('o', 'r', '/o/r/pulls', '?q=author:@meow')).toBe(false);
    expect(isMyPrsUrl('o', 'r', '/o/r/pulls', '?q=xauthor:@me')).toBe(false);
    expect(isMyPrsUrl('o', 'r', '/o/r/pulls', '?q=author:@me.extra')).toBe(false);
  });

  it('rejects missing or unrelated q', () => {
    expect(isMyPrsUrl('o', 'r', '/o/r/pulls', '')).toBe(false);
    expect(isMyPrsUrl('o', 'r', '/o/r/pulls', '?q=is:pr+is:open')).toBe(false);
    expect(isMyPrsUrl('o', 'r', '/o/r/pulls', '?q=author:octocat')).toBe(false);
  });
});

describe('parseOpenPullsCount', () => {
  const page = (open: string) => `
    <div class="issues-toolbar">
      <a href="/o/r/pulls?q=is%3Aopen+is%3Apr" class="btn-link selected" aria-current="true">
        <svg aria-hidden="true"><path d="M1.5"/></svg>
        ${open} Open
      </a>
      <a href="/o/r/pulls?q=is%3Aclosed+is%3Apr" class="btn-link">
        <svg aria-hidden="true"><path d="M1.5"/></svg>
        4,760 Closed
      </a>
    </div>`;

  it('parses the open count', () => {
    expect(parseOpenPullsCount(page('811'))).toBe(811);
    expect(parseOpenPullsCount(page('1'))).toBe(1);
    expect(parseOpenPullsCount(page('1,234'))).toBe(1234);
  });

  it('does not mistake the Closed count for Open', () => {
    expect(parseOpenPullsCount(page('0'))).toBe(0);
  });

  it('returns null when no open link exists', () => {
    expect(parseOpenPullsCount('<a href="/o/r/pulls">Pull requests</a>')).toBeNull();
    expect(parseOpenPullsCount('')).toBeNull();
  });
});

describe('extractSearchQuery', () => {
  it('reads the pulls search input value', () => {
    const html = '<input type="text" name="q" id="js-issues-search" value="is:pr is:open author:@me">';
    expect(extractSearchQuery(html)).toBe('is:pr is:open author:@me');
  });

  it('prefers the input holding a pulls query over other name=q inputs', () => {
    const html =
      '<input name="q" value="something else">' +
      '<input name="q" value="is:pr is:open author:@me">';
    expect(extractSearchQuery(html)).toBe('is:pr is:open author:@me');
  });

  it('detects the logged-out redirect page (no author filter)', () => {
    const html = '<input name="q" value="is:pr is:open">';
    expect(extractSearchQuery(html)?.includes('author:@me')).toBe(false);
  });

  it('decodes HTML entities', () => {
    const html = '<input name="q" value="is:pr author:@me label:&quot;bug&quot;">';
    expect(extractSearchQuery(html)).toBe('is:pr author:@me label:"bug"');
  });

  it('returns null without a matching input', () => {
    expect(extractSearchQuery('<input name="query" value="x">')).toBeNull();
  });
});

describe('extractUserLogin', () => {
  it('reads the logged-in username', () => {
    expect(extractUserLogin('<meta name="user-login" content="octocat">')).toBe('octocat');
  });

  it('returns null when logged out (empty content)', () => {
    expect(extractUserLogin('<meta name="user-login" content="">')).toBeNull();
  });

  it('returns null when the meta tag is absent', () => {
    expect(extractUserLogin('<html><head></head></html>')).toBeNull();
  });
});
