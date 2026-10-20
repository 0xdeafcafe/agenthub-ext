// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {beforeEach, describe, expect, it} from 'vitest';
import {commentRuns} from './comment-lines';
import {adapterFor, isFileContainer, outerFileWrapper} from './views';
import {isVirtualFile, nativeFileToggle} from './virtual-files';

const markup = readFileSync('lib/__fixtures__/react-file-2026-10.html', 'utf8');
const PATH =
  'modules/agent/process/src/rules/__tests__/agent-http-credentials-backfill.rules.unit.test.ts';

describe('GitHub React files view with hashed class names (October 2026)', () => {
  let container: Element;
  beforeEach(() => {
    document.body.innerHTML = markup;
    container = document.querySelector('[id^="diff-6e1b"]')!;
  });

  it('recognises the file, its path, header and line counts', () => {
    const adapter = adapterFor(container)!;
    expect(isFileContainer(container)).toBe(true);
    expect(adapter.name).toBe('react');
    expect(adapter.getPath(container)).toBe(PATH);
    expect(adapter.getHeader(container)?.className).toBe('diff-file-header__CV6GPS');
    expect(adapter.getChangedLines(container)).toEqual({added: 77, removed: 0});
  });

  it('still finds the path, header and counts with every hashed class name gone', () => {
    for (const element of document.querySelectorAll('[class*="__"]')) {
      element.className = [...element.classList].filter((name) => !name.includes('__')).join(' ');
      element.removeAttribute('data-diff-header-wrapper');
    }
    const adapter = adapterFor(container)!;
    expect(adapter.getPath(container)).toBe(PATH);
    const header = adapter.getHeader(container)!;
    expect(header.querySelector('h3')).not.toBeNull();
    expect(header.querySelector('button[aria-pressed]')).not.toBeNull();
    expect(header.querySelector('table')).toBeNull();
    expect(adapter.getChangedLines(container)).toEqual({added: 77, removed: 0});
  });

  it('falls back to the diff table label when the file-name class changes again', () => {
    container.querySelector('h3')!.className = 'renamed__x';
    expect(adapterFor(container)!.getPath(container)).toBe(PATH);
  });

  it('hides the whole per-file wrapper, not a positioned virtual slot', () => {
    expect(isVirtualFile(container)).toBe(false);
    expect(outerFileWrapper(container).className).toBe('diffEntry__YLOXdm');
  });

  it('finds the collapse button through its tooltip label', () => {
    expect(nativeFileToggle(container)?.getAttribute('aria-labelledby')).toBe('_R_5e4apld9io5_');
  });

  it('reads added comment-only lines from the inner code element', () => {
    const runs = commentRuns(container, PATH);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(1);
    expect(runs[0][0].textContent).toContain('/** @scenario');
  });
});
