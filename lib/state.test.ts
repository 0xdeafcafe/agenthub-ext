import {describe, expect, it} from 'vitest';
import {actionToState, cycleState, defaultStateFor, isDisplayState} from './state';
import {compileRules} from './classifier';
import {DEFAULT_CATEGORIES} from './config';

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
