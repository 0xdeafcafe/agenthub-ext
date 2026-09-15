import {afterEach, describe, expect, it, vi} from 'vitest';
import {fetchPullsCount, PULL_TABS} from './my-prs-tab';

const storage = vi.hoisted(() => ({
  get: vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({}),
  set: vi.fn<(value: unknown) => Promise<void>>().mockResolvedValue(undefined),
}));
vi.mock('wxt/browser', () => ({browser: {storage: {local: storage}}}));
afterEach(() => vi.unstubAllGlobals());

const response = (query: string): Response =>
  new Response(
    `<meta name="user-login" content="octocat"><input name="q" value="is:pr is:open ${query}"><a href="/o/r/pulls?q=is:open">7 Open</a>`,
  );

describe('pull-request counts', () => {
  it('returns the fetched count even when persistence fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('author:octocat')));
    storage.set.mockRejectedValueOnce(new Error('Quota exceeded'));
    expect(await fetchPullsCount('o', 'write-fails', PULL_TABS[0], 'octocat')).toBe(7);
  });
  it('keeps the count if an invalidated storage context throws synchronously', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('author:octocat')));
    storage.set.mockImplementationOnce(() => {
      throw new Error('Extension context invalidated');
    });
    expect(await fetchPullsCount('o', 'invalidated-context', PULL_TABS[0], 'octocat')).toBe(7);
  });
  it('rejects another user whose login starts with the requested login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('author:octocat2')));
    expect(await fetchPullsCount('o', 'wrong-user', PULL_TABS[0], 'octocat')).toBeNull();
  });
  it('matches the exact qualifier regardless of username casing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('review-requested:OctoCat')));
    expect(await fetchPullsCount('o', 'exact-user', PULL_TABS[1], 'octocat')).toBe(7);
  });
});
