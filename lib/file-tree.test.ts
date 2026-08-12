// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {beforeEach, describe, expect, it} from 'vitest';
import {
  aggregateFolderState,
  applyFolderState,
  folderDisclosure,
  folderFileStates,
  folderKey,
  isFolderRow,
  maybeAutoCollapseFolder,
  treeRowPath,
} from './file-tree';
import type {DisplayState} from './state';

beforeEach(() => {
  document.body.innerHTML = readFileSync('lib/__fixtures__/file-tree.html', 'utf8');
});

const folder = (label: string): Element =>
  [...document.querySelectorAll('[data-tree-entry-type="directory"]')].find(
    row => row.querySelector(':scope > [aria-expanded] .ActionList-item-label')?.textContent?.trim() === label,
  )!;

describe('aggregateFolderState', () => {
  it('all hidden rolls up to hidden', () => {
    expect(aggregateFolderState(['hidden', 'hidden'])).toBe('hidden');
  });

  it('all collapsed, or collapsed+hidden, rolls up to collapsed', () => {
    expect(aggregateFolderState(['collapsed'])).toBe('collapsed');
    expect(aggregateFolderState(['collapsed', 'hidden'])).toBe('collapsed');
  });

  it('a single visible file deep inside keeps the folder normal', () => {
    expect(aggregateFolderState(['hidden', 'hidden', 'visible'])).toBe('visible');
  });

  it('unknown files (not yet mounted) count as visible', () => {
    expect(aggregateFolderState(['hidden', null])).toBe('visible');
  });

  it('empty folders stay normal', () => {
    expect(aggregateFolderState([])).toBe('visible');
  });
});

describe('row inspection', () => {
  it('reads full paths from the hidden filter-text span', () => {
    expect(treeRowPath(document.querySelector('[data-tree-entry-type="file"]')!)).toBe('docs/guide.md');
  });

  it('tells folders from files', () => {
    expect(isFolderRow(folder('docs'))).toBe(true);
    expect(isFolderRow(document.querySelector('[data-tree-entry-type="file"]')!)).toBe(false);
  });

  it('builds folder keys from the label chain', () => {
    expect(folderKey(folder('api'))).toBe('docs/api');
    expect(folderKey(folder('packages'))).toBe('packages');
  });
});

describe('folder state application', () => {
  it('applies rollup classes to the folder row, never a badge', () => {
    const docs = folder('docs');
    const stateOfRow = (row: Element): DisplayState | null =>
      treeRowPath(row)?.endsWith('.ts') ? null : 'hidden';

    // guide.md + more.mdx hidden, index.ts unknown (treated visible)
    const docsState = aggregateFolderState(folderFileStates(docs, stateOfRow));
    expect(docsState).toBe('hidden');
    applyFolderState(docs, docsState);
    expect(docs.classList.contains('prix-tree-hidden')).toBe(true);
    expect(docs.querySelector('.prix-tree-badge')).toBeNull();

    const packages = folder('packages');
    const packagesState = aggregateFolderState(folderFileStates(packages, stateOfRow));
    expect(packagesState).toBe('visible'); // index.ts unknown
    applyFolderState(packages, packagesState);
    expect(packages.classList.contains('prix-tree-hidden')).toBe(false);
    expect(packages.classList.contains('prix-tree-collapsed')).toBe(false);
  });

  it('clears the classes again when a file becomes visible', () => {
    const docs = folder('docs');
    applyFolderState(docs, 'hidden');
    applyFolderState(docs, 'visible');
    expect(docs.classList.contains('prix-tree-hidden')).toBe(false);
  });
});

describe('maybeAutoCollapseFolder', () => {
  const makeCollapsible = (row: Element): void => {
    // Simulate GitHub's own disclosure behaviour
    folderDisclosure(row)!.addEventListener('click', () => {
      const control = folderDisclosure(row)!;
      control.setAttribute('aria-expanded', control.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    });
  };

  it('clicks the disclosure once when a folder goes fully faded', () => {
    const docs = folder('docs');
    makeCollapsible(docs);
    const userToggled = new Set<string>();
    const autoCollapsed = new Set<string>();

    expect(maybeAutoCollapseFolder(docs, 'hidden', userToggled, autoCollapsed)).toBe(true);
    expect(folderDisclosure(docs)!.getAttribute('aria-expanded')).toBe('false');

    expect(maybeAutoCollapseFolder(docs, 'hidden', userToggled, autoCollapsed)).toBe(false);
  });

  it('never collapses a folder the user has toggled', () => {
    const docs = folder('docs');
    makeCollapsible(docs);
    const autoCollapsed = new Set<string>();
    const userToggled = new Set<string>(['docs']);

    expect(maybeAutoCollapseFolder(docs, 'hidden', userToggled, autoCollapsed)).toBe(false);
    expect(folderDisclosure(docs)!.getAttribute('aria-expanded')).toBe('true');
  });

  it('does nothing for visible folders or already-closed disclosures', () => {
    const docs = folder('docs');
    makeCollapsible(docs);
    const autoCollapsed = new Set<string>();
    expect(maybeAutoCollapseFolder(docs, 'visible', new Set(), autoCollapsed)).toBe(false);

    folderDisclosure(docs)!.setAttribute('aria-expanded', 'false');
    expect(maybeAutoCollapseFolder(docs, 'hidden', new Set(), autoCollapsed)).toBe(false);
    expect(autoCollapsed.size).toBe(0);
  });
});
