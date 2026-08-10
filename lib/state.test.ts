import {describe, expect, it} from 'vitest';
import {actionToState, cycleState, isDisplayState} from './state';

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
