import {describe, expect, it} from 'vitest';
import {parseRepoPreferences, parseSettings, repoPreferencesKey} from './preferences';
import {explainClassification, compileRules} from './classifier';
import {DEFAULT_CATEGORIES} from './config';

describe('review preferences', () => {
  it('validates persisted settings and preserves a deliberate off switch', () => {
    expect(
      parseSettings({
        enabled: false,
        unreviewed: true,
        excludeComments: true,
        defaultStates: {tests: 'hidden', code: 'bad'},
      }),
    ).toEqual({
      enabled: false,
      unreviewed: true,
      excludeComments: true,
      defaultStates: {tests: 'hidden'},
    });
    expect(parseSettings(null).enabled).toBe(true);
  });
  it('keeps repository scopes independent and filters malformed presets', () => {
    expect(repoPreferencesKey('acme/one')).not.toBe(repoPreferencesKey('acme/two'));
    expect(
      parseRepoPreferences({
        classifications: {'a.ts': 'tests', 'b.ts': 5},
        presets: [{name: ''}, {name: 'Backend', states: {code: 'visible'}, directory: 'server'}],
      }),
    ).toEqual({
      classifications: {'a.ts': 'tests'},
      presets: [
        {
          name: 'Backend',
          states: {code: 'visible'},
          directory: 'server',
          unreviewed: false,
          excludeComments: false,
        },
      ],
    });
  });
  it('explains the matching glob, overrides, and fallback', () => {
    const rules = compileRules(DEFAULT_CATEGORIES);
    expect(explainClassification('tests/main.test.ts', rules)).toContain('**/*.test.*');
    expect(explainClassification('main.ts', rules)).toContain('No category rule matched');
    expect(explainClassification('main.ts', rules, 'docs')).toContain('repository override');
  });
});
