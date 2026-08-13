// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {beforeEach, describe, expect, it} from 'vitest';
import {
  aggregateFolderState,
  applyFolderState,
  folderDisclosure,
  folderFileStates,
  folderKey,
  folderStatesByPath,
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
    folderDisclosure(row)!.toggle.addEventListener('click', () => {
      const holder = folderDisclosure(row)!.stateHolder;
      holder.setAttribute('aria-expanded', holder.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    });
  };

  it('clicks the disclosure once when a folder goes fully faded', () => {
    const docs = folder('docs');
    makeCollapsible(docs);
    const userToggled = new Set<string>();
    const autoCollapsed = new Set<string>();

    expect(maybeAutoCollapseFolder(docs, 'hidden', userToggled, autoCollapsed)).toBe(true);
    expect(folderDisclosure(docs)!.stateHolder.getAttribute('aria-expanded')).toBe('false');

    expect(maybeAutoCollapseFolder(docs, 'hidden', userToggled, autoCollapsed)).toBe(false);
  });

  it('never collapses a folder the user has toggled', () => {
    const docs = folder('docs');
    makeCollapsible(docs);
    const autoCollapsed = new Set<string>();
    const userToggled = new Set<string>(['docs']);

    expect(maybeAutoCollapseFolder(docs, 'hidden', userToggled, autoCollapsed)).toBe(false);
    expect(folderDisclosure(docs)!.stateHolder.getAttribute('aria-expanded')).toBe('true');
  });

  it('does nothing for visible folders or already-closed disclosures', () => {
    const docs = folder('docs');
    makeCollapsible(docs);
    const autoCollapsed = new Set<string>();
    expect(maybeAutoCollapseFolder(docs, 'visible', new Set(), autoCollapsed)).toBe(false);

    folderDisclosure(docs)!.stateHolder.setAttribute('aria-expanded', 'false');
    expect(maybeAutoCollapseFolder(docs, 'hidden', new Set(), autoCollapsed)).toBe(false);
    expect(autoCollapsed.size).toBe(0);
  });
});

describe('react TreeView rows', () => {
  beforeEach(() => {
    // Modelled on the live React files view markup (probed from a
    // langwatch/langwatch /changes page): Primer TreeView, the row's id is
    // the full path, aria-expanded lives on the folder row, and the clickable
    // controls are grandchildren (li > item-container > toggle/content).
    document.body.innerHTML = `
      <ul role="tree">
        <li role="treeitem" aria-level="1" aria-expanded="true" id="platform" class="PRIVATE_TreeView-item prc-TreeView-TreeViewItem-Ter5f">
          <div class="PRIVATE_TreeView-item-container">
            <div class="PRIVATE_TreeView-item-toggle"><svg></svg></div>
            <div class="PRIVATE_TreeView-item-content"><span class="PRIVATE_TreeView-item-content-text"><span>platform</span></span></div>
          </div>
          <ul role="group">
            <li role="treeitem" aria-level="2" id="platform/app/src/__tests__/foo.unit.test.ts" class="PRIVATE_TreeView-item DiffFileTree-module__file-tree-row__PCB1B" aria-label="foo.unit.test.ts">
              <div class="PRIVATE_TreeView-item-container">
                <div class="PRIVATE_TreeView-item-content"><a href="#diff-aaa111">foo.unit.test.ts</a></div>
              </div>
            </li>
            <li role="treeitem" aria-level="2" id="platform/app/src/index.ts" class="PRIVATE_TreeView-item DiffFileTree-module__file-tree-row__PCB1B" aria-label="index.ts">
              <div class="PRIVATE_TreeView-item-container">
                <div class="PRIVATE_TreeView-item-content"><a href="#diff-bbb222">index.ts</a></div>
              </div>
            </li>
          </ul>
        </li>
      </ul>`;
  });

  it('reads the full path from the row id', () => {
    expect(treeRowPath(document.getElementById('platform/app/src/__tests__/foo.unit.test.ts')!)).toBe(
      'platform/app/src/__tests__/foo.unit.test.ts',
    );
  });

  it('tells folders from files via aria-expanded on the row', () => {
    expect(isFolderRow(document.getElementById('platform')!)).toBe(true);
    expect(isFolderRow(document.getElementById('platform/app/src/index.ts')!)).toBe(false);
  });

  it('uses the row id as the folder key', () => {
    expect(folderKey(document.getElementById('platform')!)).toBe('platform');
  });

  it('rolls folder state up by path prefix, no DOM nesting required', () => {
    const states = new Map<string, DisplayState>([
      ['platform/app/src/__tests__/foo.unit.test.ts', 'collapsed'],
      ['platform/app/src/index.ts', 'collapsed'],
    ]);
    expect(aggregateFolderState(folderStatesByPath('platform', states))).toBe('collapsed');
    expect(folderStatesByPath('other', states)).toEqual([]);
  });

  it('auto-collapses by clicking the chevron toggle while reading state from the row', () => {
    const folderRow = document.getElementById('platform')!;
    const disclosure = folderDisclosure(folderRow)!;
    expect(disclosure.stateHolder).toBe(folderRow);
    expect(disclosure.toggle.className).toContain('TreeView-item-toggle');
    disclosure.toggle.addEventListener('click', () => {
      folderRow.setAttribute('aria-expanded', 'false');
    });

    const autoCollapsed = new Set<string>();
    expect(maybeAutoCollapseFolder(folderRow, 'collapsed', new Set(), autoCollapsed)).toBe(true);
    expect(folderRow.getAttribute('aria-expanded')).toBe('false');
    expect(autoCollapsed.has('platform')).toBe(true);
  });
});
