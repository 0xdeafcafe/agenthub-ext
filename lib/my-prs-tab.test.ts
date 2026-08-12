import {describe, expect, it} from 'vitest';
import {activePullsTabId, buildMyPrsHref, buildPullsHref, extractSearchQuery, extractUserLogin, isMyPrsUrl, isTabActive, parseOpenPullsCount, PULL_TABS} from './my-prs-tab';

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
    expect(isMyPrsUrl('o', 'r', null, '/o/r/pulls', '?q=is%3Apr+is%3Aopen+author%3A%40me')).toBe(true);
    expect(isMyPrsUrl('o', 'r', null, '/o/r/pulls', '?q=is:pr+is:open+author:@me')).toBe(true);
    expect(isMyPrsUrl('o', 'r', null, '/o/r/pulls', '?q=author:@me')).toBe(true);
    expect(isMyPrsUrl('o', 'r', null, '/o/r/pulls', '?q=is:open+author:@me+sort:updated-desc')).toBe(true);
  });

  it('tolerates a trailing slash on the path', () => {
    expect(isMyPrsUrl('o', 'r', null, '/o/r/pulls/', '?q=author:@me')).toBe(true);
  });

  it('rejects other pages even with author:@me in q', () => {
    expect(isMyPrsUrl('o', 'r', null, '/o/r/issues', '?q=author:@me')).toBe(false);
    expect(isMyPrsUrl('o', 'r', null, '/o/r/pulls/123', '?q=author:@me')).toBe(false);
    expect(isMyPrsUrl('o', 'r', null, '/o/r', '?q=author:@me')).toBe(false);
  });

  it('rejects other repos', () => {
    expect(isMyPrsUrl('o', 'r', null, '/o/other/pulls', '?q=author:@me')).toBe(false);
    expect(isMyPrsUrl('o', 'r', null, '/other/r/pulls', '?q=author:@me')).toBe(false);
  });

  it('rejects author:@me as a substring of another token', () => {
    expect(isMyPrsUrl('o', 'r', null, '/o/r/pulls', '?q=author:@meow')).toBe(false);
    expect(isMyPrsUrl('o', 'r', null, '/o/r/pulls', '?q=xauthor:@me')).toBe(false);
    expect(isMyPrsUrl('o', 'r', null, '/o/r/pulls', '?q=author:@me.extra')).toBe(false);
  });

  it('rejects missing or unrelated q', () => {
    expect(isMyPrsUrl('o', 'r', null, '/o/r/pulls', '')).toBe(false);
    expect(isMyPrsUrl('o', 'r', null, '/o/r/pulls', '?q=is:pr+is:open')).toBe(false);
    expect(isMyPrsUrl('o', 'r', null, '/o/r/pulls', '?q=author:octocat')).toBe(false);
  });

  it('matches author:<login> when logged in, case-insensitively', () => {
    expect(isMyPrsUrl('o', 'r', 'octocat', '/o/r/pulls', '?q=is:pr+is:open+author:octocat')).toBe(true);
    expect(isMyPrsUrl('o', 'r', 'octocat', '/o/r/pulls', '?q=author:OctoCat')).toBe(true);
  });

  it('rejects another user\'s login and substring logins', () => {
    expect(isMyPrsUrl('o', 'r', 'octocat', '/o/r/pulls', '?q=author:hubot')).toBe(false);
    expect(isMyPrsUrl('o', 'r', 'octocat', '/o/r/pulls', '?q=author:octocat2')).toBe(false);
    expect(isMyPrsUrl('o', 'r', 'octocat', '/o/r/pulls', '?q=xauthor:octocat')).toBe(false);
  });

  it('treats /pulls/@me as mine only when logged in', () => {
    expect(isMyPrsUrl('o', 'r', 'octocat', '/o/r/pulls/@me', '')).toBe(true);
    expect(isMyPrsUrl('o', 'r', null, '/o/r/pulls/@me', '')).toBe(false);
    expect(isMyPrsUrl('o', 'r', 'octocat', '/other/r/pulls/@me', '')).toBe(false);
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

describe('buildPullsHref', () => {
  it('builds a review-requested URL', () => {
    expect(buildPullsHref('o', 'r', 'review-requested', '@me')).toBe(
      '/o/r/pulls?q=is%3Apr+is%3Aopen+review-requested%3A%40me',
    );
    expect(buildPullsHref('o', 'r', 'review-requested', 'octocat')).toBe(
      '/o/r/pulls?q=is%3Apr+is%3Aopen+review-requested%3Aoctocat',
    );
  });
});

describe('isTabActive (review requested)', () => {
  const reviewTab = PULL_TABS[1];

  it('matches review-requested:@me and review-requested:<login>', () => {
    expect(isTabActive(reviewTab, 'o', 'r', null, '/o/r/pulls', '?q=is:pr+review-requested:@me')).toBe(true);
    expect(isTabActive(reviewTab, 'o', 'r', 'octocat', '/o/r/pulls', '?q=review-requested:OctoCat')).toBe(true);
  });

  it('does not match the author qualifier or substring lookalikes', () => {
    expect(isTabActive(reviewTab, 'o', 'r', null, '/o/r/pulls', '?q=author:@me')).toBe(false);
    expect(isTabActive(reviewTab, 'o', 'r', null, '/o/r/pulls', '?q=review-requested:@meh')).toBe(false);
  });

  it('treats /pulls/review-requested/@me as mine only when logged in', () => {
    expect(isTabActive(reviewTab, 'o', 'r', 'octocat', '/o/r/pulls/review-requested/@me', '')).toBe(true);
    expect(isTabActive(reviewTab, 'o', 'r', null, '/o/r/pulls/review-requested/@me', '')).toBe(false);
  });

  it('does not claim the plain /pulls/@me path', () => {
    expect(isTabActive(reviewTab, 'o', 'r', 'octocat', '/o/r/pulls/@me', '')).toBe(false);
  });
});

describe('activePullsTabId', () => {
  it('picks the matching tab', () => {
    expect(activePullsTabId('o', 'r', null, '/o/r/pulls', '?q=author:@me')).toBe('my-prs-repo-tab');
    expect(activePullsTabId('o', 'r', null, '/o/r/pulls', '?q=review-requested:@me')).toBe(
      'review-requested-repo-tab',
    );
    expect(activePullsTabId('o', 'r', null, '/o/r/pulls', '?q=is:pr')).toBeNull();
  });

  it('table order wins when a query matches both', () => {
    expect(activePullsTabId('o', 'r', null, '/o/r/pulls', '?q=author:@me+review-requested:@me')).toBe(
      'my-prs-repo-tab',
    );
  });
});
