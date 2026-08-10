import {describe, expect, it} from 'vitest';
import {actionFor, classify, compileRules} from './classifier';
import {DEFAULT_CATEGORIES} from './config';

const rules = compileRules(DEFAULT_CATEGORIES);

describe('classify with default rules', () => {
  it('classifies test files', () => {
    expect(classify('src/foo.test.ts', rules)).toBe('tests');
    expect(classify('src/foo.spec.tsx', rules)).toBe('tests');
    expect(classify('packages/app/__tests__/index.js', rules)).toBe('tests');
    expect(classify('pkg/util/tests/test_helper.py', rules)).toBe('tests');
    expect(classify('foo.test.ts', rules)).toBe('tests');
  });

  it('classifies docs', () => {
    expect(classify('README.md', rules)).toBe('docs');
    expect(classify('docs/guide.mdx', rules)).toBe('docs');
    expect(classify('packages/web/docs/api.md', rules)).toBe('docs');
  });

  it('classifies generated files and lockfiles', () => {
    expect(classify('proto/user.pb.go', rules)).toBe('generated');
    expect(classify('src/client.generated.ts', rules)).toBe('generated');
    expect(classify('package-lock.json', rules)).toBe('generated');
    expect(classify('apps/web/yarn.lock', rules)).toBe('generated');
    expect(classify('pnpm-lock.yaml', rules)).toBe('generated');
    expect(classify('go.sum', rules)).toBe('generated');
    expect(classify('Cargo.lock', rules)).toBe('generated');
  });

  it('falls back to code for unmatched paths', () => {
    expect(classify('src/index.ts', rules)).toBe('code');
    expect(classify('server/main.go', rules)).toBe('code');
    expect(classify('.github/workflows/ci.yml', rules)).toBe('code');
  });

  it('does not misclassify similar names', () => {
    expect(classify('src/testable.ts', rules)).toBe('code');
    expect(classify('src/markdown.ts', rules)).toBe('code');
    expect(classify('src/generate.ts', rules)).toBe('code');
  });
});

describe('rule precedence', () => {
  it('first matching rule wins', () => {
    const ordered = compileRules([
      {name: 'server', globs: ['server/**'], action: 'visible'},
      {name: 'tests', globs: ['**/*.test.*'], action: 'collapse'},
    ]);
    expect(classify('server/api.test.ts', ordered)).toBe('server');

    const reversed = compileRules([
      {name: 'tests', globs: ['**/*.test.*'], action: 'collapse'},
      {name: 'server', globs: ['server/**'], action: 'visible'},
    ]);
    expect(classify('server/api.test.ts', reversed)).toBe('tests');
  });

  it('supports arbitrary user-defined categories', () => {
    const custom = compileRules([{name: 'sdk', globs: ['sdk/**', 'packages/sdk*/**'], action: 'hide'}]);
    expect(classify('sdk/client.go', custom)).toBe('sdk');
    expect(classify('packages/sdk-node/index.ts', custom)).toBe('sdk');
    expect(classify('app/main.ts', custom)).toBe('code');
  });
});

describe('actionFor', () => {
  it('returns the rule action and defaults to visible', () => {
    expect(actionFor('tests', rules)).toBe('collapse');
    expect(actionFor('docs', rules)).toBe('hide');
    expect(actionFor('code', rules)).toBe('visible');
  });
});
