import {describe, expect, it} from 'vitest';
import {YAMLParseError} from 'yaml';
import {DEFAULT_CONFIG, parseConfig, withGitattributesGenerated} from './config';

const EXAMPLE = `
categories:
  tests:
    globs: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/test/**", "**/tests/**"]
    action: collapse
  docs:
    globs: ["**/*.md", "**/*.mdx", "docs/**"]
    action: hide
  generated:
    globs: ["**/*.pb.go", "**/*.generated.*", "**/gen/**", "**/generated/**"]
    action: hide
  server:
    globs: ["server/**"]
    action: visible
`;

describe('parseConfig', () => {
  it('parses a valid config preserving order and actions', () => {
    const {rules} = parseConfig(EXAMPLE);
    expect(rules.map((rule) => rule.name)).toEqual(['tests', 'docs', 'generated', 'server']);
    expect(rules.map((rule) => rule.action)).toEqual(['collapse', 'hide', 'hide', 'visible']);
    expect(rules[3].globs).toEqual(['server/**']);
  });

  it('returns null defaultView when the key is absent or junk', () => {
    expect(parseConfig(EXAMPLE).defaultView).toBeNull();
    expect(
      parseConfig('defaultView: code\ncategories:\n  sdk:\n    globs: ["sdk/**"]\n').defaultView,
    ).toBeNull();
    expect(
      parseConfig('defaultView: []\ncategories:\n  sdk:\n    globs: ["sdk/**"]\n').defaultView,
    ).toBeNull();
  });

  it('parses defaultView as a list of category names', () => {
    const config = parseConfig(
      'defaultView: [code, server]\ncategories:\n  sdk:\n    globs: ["sdk/**"]\n',
    );
    expect(config.defaultView).toEqual(['code', 'server']);
  });

  it('defaults a missing action to visible', () => {
    const {rules} = parseConfig('categories:\n  sdk:\n    globs: ["sdk/**"]\n');
    expect(rules).toEqual([{name: 'sdk', globs: ['sdk/**'], action: 'visible'}]);
  });

  it('rejects an invalid action but keeps the category with visible', () => {
    const {rules} = parseConfig('categories:\n  sdk:\n    globs: ["sdk/**"]\n    action: nuke\n');
    expect(rules[0].action).toBe('visible');
  });

  it('ignores unknown keys', () => {
    const {rules} = parseConfig(
      'version: 2\ncategories:\n  sdk:\n    globs: ["sdk/**"]\n    color: red\nextra: true\n',
    );
    expect(rules).toEqual([{name: 'sdk', globs: ['sdk/**'], action: 'visible'}]);
  });

  it('skips categories without usable globs', () => {
    const {rules} = parseConfig(
      'categories:\n  broken:\n    action: hide\n  empty:\n    globs: []\n  fine:\n    globs: ["a/**"]\n',
    );
    expect(rules.map((rule) => rule.name)).toEqual(['fine']);
  });

  it('throws on junk YAML', () => {
    expect(() => parseConfig('{[{:].')).toThrow(YAMLParseError);
  });

  it('throws on non-mapping roots', () => {
    expect(() => parseConfig('just a string')).toThrow('root must be a mapping');
    expect(() => parseConfig('- a\n- b\n')).toThrow('root must be a mapping');
    expect(() => parseConfig('')).toThrow('root must be a mapping');
  });

  it('throws when categories is missing or yields nothing valid', () => {
    expect(() => parseConfig('other: 1\n')).toThrow('missing `categories` mapping');
    expect(() => parseConfig('categories: {}\n')).toThrow('no valid categories');
    expect(() => parseConfig('categories:\n  broken:\n    action: hide\n')).toThrow(
      'no valid categories',
    );
  });
});

describe('withGitattributesGenerated', () => {
  it('appends new globs to the generated category', () => {
    const merged = withGitattributesGenerated(DEFAULT_CONFIG, ['**/schema.sql']);
    const rule = merged.rules.find((rule) => rule.name === 'generated');
    expect(rule?.globs).toContain('**/schema.sql');
    expect(rule?.globs).toEqual(expect.arrayContaining(DEFAULT_CONFIG.rules[3].globs));
  });

  it('does not duplicate a glob already present', () => {
    const merged = withGitattributesGenerated(DEFAULT_CONFIG, ['**/*.pb.go']);
    expect(merged).toBe(DEFAULT_CONFIG);
  });

  it('leaves the config untouched when there is no generated category', () => {
    const config = {
      rules: [{name: 'server', globs: ['server/**'], action: 'visible' as const}],
      defaultView: null,
    };
    expect(withGitattributesGenerated(config, ['**/schema.sql'])).toBe(config);
  });

  it('leaves the config untouched when there are no new globs', () => {
    expect(withGitattributesGenerated(DEFAULT_CONFIG, [])).toBe(DEFAULT_CONFIG);
  });

  it('does not mutate the original config', () => {
    const before = JSON.stringify(DEFAULT_CONFIG);
    withGitattributesGenerated(DEFAULT_CONFIG, ['**/schema.sql']);
    expect(JSON.stringify(DEFAULT_CONFIG)).toBe(before);
  });
});
