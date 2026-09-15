import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  actionToState,
  CategoryStateStore,
  cycleState,
  defaultStateFor,
  isDisplayState,
} from './state';
import {compileRules} from './classifier';
import {DEFAULT_CATEGORIES} from './config';

const storage = vi.hoisted(() => ({
  get: vi.fn<(key: string) => Promise<Record<string, unknown>>>(),
  set: vi.fn<(values: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined),
}));
vi.mock('wxt/browser', () => ({browser: {storage: {local: storage}}}));
beforeEach(() => vi.clearAllMocks());

describe('CategoryStateStore', () => {
  it('applies a preset with one notification and one storage write', async () => {
    const store = new CategoryStateStore();
    const listener = vi.fn<(categories: ReadonlySet<string>) => void>();
    store.subscribe(listener);
    store.setMany([
      ['code', 'visible'],
      ['tests', 'collapsed'],
      ['docs', 'hidden'],
    ]);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect([...listener.mock.calls[0][0]]).toEqual(['code', 'tests', 'docs']);
    expect(storage.set).toHaveBeenCalledExactlyOnceWith({
      'prix:categoryStates': {code: 'visible', tests: 'collapsed', docs: 'hidden'},
    });
    store.set('tests', 'collapsed');
    await Promise.resolve();
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('loads valid preferences and ignores malformed states', async () => {
    storage.get.mockResolvedValueOnce({'prix:categoryStates': {code: 'hidden', docs: 'broken'}});
    const store = new CategoryStateStore();
    await store.load();
    expect(store.get('code', 'visible')).toBe('hidden');
    expect(store.get('docs', 'visible')).toBe('visible');
  });

  it('keeps filters usable if an extension reload invalidates storage', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      storage.set.mockImplementationOnce(() => {
        throw new Error('Extension context invalidated');
      });
      const store = new CategoryStateStore();
      store.set('tests', 'hidden');
      await Promise.resolve();
      expect(store.get('tests', 'visible')).toBe('hidden');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('cycleState', () => {
  it('cycles visible → collapsed → hidden → visible', () => {
    expect(cycleState('visible')).toBe('collapsed');
    expect(cycleState('collapsed')).toBe('hidden');
    expect(cycleState('hidden')).toBe('visible');
  });
});

describe('actionToState', () => {
  it('maps config actions to display states', () => {
    expect(actionToState('visible')).toBe('visible');
    expect(actionToState('collapse')).toBe('collapsed');
    expect(actionToState('hide')).toBe('hidden');
  });
});

describe('isDisplayState', () => {
  it('accepts only valid states', () => {
    expect(isDisplayState('visible')).toBe(true);
    expect(isDisplayState('collapsed')).toBe(true);
    expect(isDisplayState('hidden')).toBe(true);
    expect(isDisplayState('gone')).toBe(false);
    expect(isDisplayState(42)).toBe(false);
    expect(isDisplayState(null)).toBe(false);
  });
});

describe('defaultStateFor', () => {
  const rules = compileRules(DEFAULT_CATEGORIES);

  it('with a defaultView, listed categories are visible and the rest hidden', () => {
    expect(defaultStateFor('code', rules, ['code'])).toBe('visible');
    expect(defaultStateFor('tests', rules, ['code'])).toBe('hidden');
    expect(defaultStateFor('docs', rules, ['code'])).toBe('hidden');
    expect(defaultStateFor('server', rules, ['code', 'server'])).toBe('visible');
  });

  it('without a defaultView, the configured actions rule', () => {
    expect(defaultStateFor('code', rules, null)).toBe('visible');
    expect(defaultStateFor('tests', rules, null)).toBe('collapsed');
    expect(defaultStateFor('docs', rules, null)).toBe('hidden');
    expect(defaultStateFor('generated', rules, null)).toBe('hidden');
  });
});
