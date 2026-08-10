import picomatch from 'picomatch';

export type CategoryAction = 'visible' | 'collapse' | 'hide';

export interface CategoryRule {
  name: string;
  globs: string[];
  action: CategoryAction;
}

export interface CompiledRule extends CategoryRule {
  matches: (path: string) => boolean;
}

export function compileRule(rule: CategoryRule): CompiledRule {
  // dot: true so `**/*` also matches dotfiles like `.github/workflows/x.yml`
  const matchers = rule.globs.map(glob => picomatch(glob, {dot: true}));
  return {...rule, matches: path => matchers.some(isMatch => isMatch(path))};
}

export function compileRules(rules: CategoryRule[]): CompiledRule[] {
  return rules.map(compileRule);
}

/** First matching rule wins; unmatched paths fall into the implicit `code` category. */
export function classify(path: string, rules: CompiledRule[]): string {
  for (const rule of rules) {
    if (rule.matches(path)) {
      return rule.name;
    }
  }

  return 'code';
}

export function actionFor(category: string, rules: CompiledRule[]): CategoryAction {
  return rules.find(rule => rule.name === category)?.action ?? 'visible';
}
