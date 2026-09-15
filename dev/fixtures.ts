import './preview.css';

type Fixture = {path: string; added: number; removed: number; id?: string};
import initialFiles from './files.json';
let files: Fixture[] = [...initialFiles];
const escape = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const idFor = (i: number): string =>
  files[i]?.id ?? `diff-${(i + 1).toString(16).padStart(32, '0')}`;
const isReact = (): boolean => location.pathname.includes('/changes');
const isOverview = (): boolean => /\/pull\/42\/?$/.test(location.pathname);
const isVirtual = (): boolean =>
  isReact() && new URLSearchParams(location.search).get('mode') === 'virtualization';

function fileMarkup(file: Fixture, i: number): string {
  const header = isReact() ? 'DiffFileHeader-module__diff-file-header__fixture' : 'file-header';
  return `<div class="fixture-slot"><div id="${idFor(i)}" class="fixture-file ${isReact() ? '' : 'js-file'}" data-tagsearch-path="${escape(file.path)}">
    <div class="${header} fixture-file-header" data-path="${escape(file.path)}">
      ${isVirtual() ? '<button type="button" class="fixture-native-toggle" aria-label="Collapse file" aria-expanded="true">⌄</button>' : '<span aria-hidden="true">⌄</span>'}
      <h3 class="DiffFileHeader-module__file-name__fixture"><code>${escape(file.path)}</code></h3>
      <span class="fixture-stats" aria-label="${file.added} additions &amp; ${file.removed} deletions"><b>+${file.added.toLocaleString('en-US')}</b><em>−${file.removed.toLocaleString('en-US')}</em></span>
      ${isReact() ? '<button type="button" class="MarkAsViewedButton-fixture" aria-pressed="false">Viewed</button>' : '<label class="fixture-viewed"><input type="checkbox" class="js-reviewed-checkbox"> Viewed</label>'}
    </div>
    <div class="fixture-diff"><div class="fixture-hunk">@@ -24,7 +24,12 @@ export function createReview(files: ChangedFile[]) {</div>
    ${[
      ['context', '  const changes = collectChanges(files);'],
      ['context', '  const categories = classifyFiles(changes);'],
      ['deletion', '- return renderFiles(changes);'],
      ['addition', '+ const focused = categories.filter(isRelevant);'],
      ['addition', '+ const progress = trackReview(focused);'],
      ['addition', '+'],
      ['addition', '+ return renderReview({ files: focused, progress });'],
      ['context', '}'],
    ]
      .map(
        ([type, code], row) =>
          `<div class="fixture-line blob-code-${type}"><span>${row + 24}</span><span>${row + 24}</span><code>${escape(code)}</code></div>`,
      )
      .join('')}
    </div></div></div>`;
}

function treeMarkup(): string {
  return `<aside class="fixture-tree"><div class="fixture-tree-title">Files changed <span>${files.length}</span></div><ul role="tree">${files
    .map(
      (file, i) =>
        `<li class="${isReact() ? 'DiffFileTree-module__file-tree-row__fixture' : 'js-tree-node'}" id="${isReact() ? escape(file.path) : `file-tree-item-${idFor(i)}`}" role="treeitem"><span data-filterable-item-text hidden>${escape(file.path)}</span><a href="#${idFor(i)}"><span aria-hidden="true">▧</span> ${escape(file.path)}</a></li>`,
    )
    .join('')}</ul></aside>`;
}

let virtualRender: (() => void) | null = null;
const collapsedFiles = new Set<number>();
const virtualMetrics = {renders: 0, nativeClicks: 0};
function mountVirtualFixture(): void {
  const scroller = document.querySelector<HTMLElement>('#fixture-files')!;
  scroller.dataset.virtualizer = 'true';
  scroller.style.cssText =
    'height: 440px; overflow: auto; position: relative; overflow-anchor: none';
  const spacer = document.createElement('div');
  spacer.className = 'fixture-virtual-spacer';
  spacer.style.position = 'relative';
  scroller.replaceChildren(spacer);
  virtualRender = () => {
    if (!scroller.isConnected) return;
    virtualMetrics.renders++;
    const positions: number[] = [];
    let total = 0;
    for (let i = 0; i < files.length; i++) {
      positions.push(total);
      total += collapsedFiles.has(i) ? 60 : 340;
    }
    spacer.style.height = `${total}px`;
    const visible = positions
      .map((top, i) => ({top, i}))
      .filter(
        ({top, i}) =>
          top + (collapsedFiles.has(i) ? 60 : 340) > scroller.scrollTop - 60 &&
          top < scroller.scrollTop + 500,
      );
    const pool = [...spacer.children] as HTMLElement[];
    for (const [slotIndex, {top, i}] of visible.entries()) {
      let slot = pool[slotIndex];
      if (!slot) {
        const template = document.createElement('template');
        template.innerHTML = fileMarkup(files[i], i);
        slot = template.content.firstElementChild as HTMLElement;
        spacer.append(slot);
      }
      const container = slot.firstElementChild as HTMLElement;
      container.id = idFor(i);
      container.dataset.tagsearchPath = files[i].path;
      const name = container.querySelector('h3 code')!;
      if (name.textContent !== files[i].path) name.textContent = files[i].path;
      const header = container.querySelector<HTMLElement>('.fixture-file-header')!;
      header.dataset.path = files[i].path;
      const stats = container.querySelector('.fixture-stats')!;
      stats.setAttribute(
        'aria-label',
        `${files[i].added} additions & ${files[i].removed} deletions`,
      );
      const toggle = container.querySelector('.fixture-native-toggle')!;
      toggle.setAttribute('aria-expanded', String(!collapsedFiles.has(i)));
      toggle.setAttribute('aria-label', collapsedFiles.has(i) ? 'Expand file' : 'Collapse file');
      (container.querySelector('.fixture-diff') as HTMLElement).hidden = collapsedFiles.has(i);
      slot.dataset.index = String(i);
      slot.style.cssText = `position: absolute; top: 0; left: 0; right: 0; height: ${collapsedFiles.has(i) ? 60 : 340}px; transform: translateY(${top}px)`;
    }
    for (const slot of pool.slice(visible.length)) slot.remove();
  };
  scroller.addEventListener('scroll', () => virtualRender?.());
  virtualRender();
}

function render(): void {
  document.querySelector('#fixture-root')!.innerHTML = `
    <header class="fixture-global"><span class="fixture-logo">◈</span><span>acme <span class="fixture-muted">/</span> <strong>review-kit</strong></span><span class="fixture-private">Public</span></header>
    <nav aria-label="Repository"><ul class="fixture-repo-nav"><li><a href="#">Code</a></li><li><a href="#">Issues <span class="Counter">12</span></a></li><li><a id="pull-requests-tab" class="selected" href="/acme/review-kit/pulls"><span data-content="Pull requests">Pull requests</span><span class="Counter">8</span></a></li><li><a href="#">Actions</a></li></ul></nav>
    <main><div class="fixture-page">
    <div class="fixture-pr-heading"><div class="fixture-eyebrow">PULL REQUEST</div><h1>Make every review count <span>#42</span></h1><p><span class="fixture-open">⤴ Open</span> <strong>alex</strong> wants to merge 4 commits into <code>main</code> from <code>feature/review-focus</code></p></div>
    <nav class="fixture-pr-tabs" aria-label="Pull request navigation"><a href="/acme/review-kit/pull/42">Conversation <span>3</span></a><a href="/acme/review-kit/pull/42/commits">Commits <span>4</span></a><a class="selected" href="${isOverview() ? '/acme/review-kit/pull/42/changes' : location.pathname}">Files changed <span>${files.length}</span></a></nav>
    ${
      isOverview()
        ? '<section class="fixture-conversation"><h2>Conversation</h2><article><strong>alex</strong><p>This change improves the review experience. The discussion and comments stay here.</p></article><aside>Reviewers · Labels · Milestone</aside></section>'
        : `<section class="pr-toolbar"><span><strong>Changes</strong><span class="fixture-muted"> · All commits</span></span><button type="button">Review changes</button></section>
    <div class="fixture-workspace">${treeMarkup()}<div id="fixture-files">${(new URLSearchParams(location.search).get('scenario') === 'virtualized' ? files.slice(0, 3) : files).map(fileMarkup).join('')}</div></div>`
    }
    </div></main>`;
  if (isOverview() || isVirtual()) {
    const layout = document.querySelector<HTMLElement>('.fixture-page')!;
    layout.style.display = 'flex';
    layout.style.flexWrap = 'wrap';
    for (const child of layout.children) (child as HTMLElement).style.flex = '0 0 100%';
  }
  if (isVirtual()) mountVirtualFixture();
}

const harness = {
  virtualMetrics,
  virtualScroll(top: number): void {
    document.querySelector('#fixture-files')!.scrollTop = top;
    virtualRender?.();
  },
  remount(): void {
    const container = document.getElementById(idFor(0))!;
    container.replaceWith(container.cloneNode(true));
  },
  rerenderHeader(): void {
    const header = document.querySelector('.fixture-file-header')!;
    const clone = header.cloneNode(true) as Element;
    clone.querySelector('.prix-badge')?.remove();
    clone.classList.remove('prix-header');
    header.replaceWith(clone);
  },
  addFiles(amount = 1): void {
    const fragment = document.createDocumentFragment();
    const start = files.length;
    for (let i = 0; i < amount; i++) {
      const file = {path: `src/lazy/worker-${start + i}.ts`, added: 12, removed: 3};
      files.push(file);
      const template = document.createElement('template');
      template.innerHTML = fileMarkup(file, start + i);
      fragment.append(template.content);
    }
    document.querySelector('#fixture-files')!.append(fragment);
    document.querySelector('.fixture-tree')!.outerHTML = treeMarkup();
  },
  navigate(view: 'classic' | 'react' = isReact() ? 'classic' : 'react'): void {
    document.dispatchEvent(new Event('turbo:before-render'));
    history.pushState(
      {},
      '',
      `/acme/review-kit/pull/42/${view === 'react' ? 'changes' : 'files'}${location.search}`,
    );
    files = [...initialFiles];
    render();
    document.dispatchEvent(new Event('turbo:render'));
    document.dispatchEvent(new Event('soft-nav:react-done'));
  },
  reset(): void {
    for (const key of Object.keys(localStorage))
      if (key.startsWith('preview:')) localStorage.removeItem(key);
    localStorage.removeItem('prix-disabled');
    location.reload();
  },
};
declare global {
  interface Window {
    prixHarness: typeof harness;
  }
}
window.prixHarness = harness;

document.documentElement.dataset.colorMode =
  new URLSearchParams(location.search).get('theme') ?? 'light';
document.body.innerHTML = `<div class="fixture-devbar"><a href="/">PR Impact <strong>Playground</strong></a><div>
  <button data-action="theme">Light / dark</button><button data-action="navigate">Classic / React</button><button data-action="addFiles">Load file</button><button data-action="stress">+250 files</button><button data-action="remount">Remount</button><button data-action="rerenderHeader">Replace header</button><button data-action="reset">Reset</button><a href="/screenshots/">Screenshots ↗</a>
  </div></div><div id="fixture-root"></div>`;
render();
document.querySelector('.fixture-devbar')!.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset
    .action;
  if (action === 'theme') {
    const theme = document.documentElement.dataset.colorMode === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.colorMode = theme;
    const url = new URL(location.href);
    url.searchParams.set('theme', theme);
    history.replaceState({}, '', url);
  } else if (action === 'stress') harness.addFiles(250);
  else if (action === 'navigate') harness.navigate();
  else if (action && action in harness) (harness[action as keyof typeof harness] as () => void)();
});
document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const toggle = target.closest('.fixture-native-toggle');
  if (toggle) {
    const index = Number(toggle.closest<HTMLElement>('[data-index]')!.dataset.index);
    if (collapsedFiles.has(index)) collapsedFiles.delete(index);
    else collapsedFiles.add(index);
    virtualMetrics.nativeClicks++;
    requestAnimationFrame(() => virtualRender?.());
  }

  const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
    '.fixture-tree a[href^="#diff-"]',
  );
  if (anchor && isVirtual()) {
    event.preventDefault();
    const index = files.findIndex((_, i) => `#${idFor(i)}` === anchor.hash);
    if (index >= 0) {
      const top = files
        .slice(0, index)
        .reduce((sum, _, i) => sum + (collapsedFiles.has(i) ? 60 : 340), 0);
      harness.virtualScroll(top);
    }
  } else if (anchor && !document.getElementById(anchor.hash.slice(1))) {
    const index = files.findIndex((_, i) => `#${idFor(i)}` === anchor.hash);
    if (index >= 0)
      document
        .querySelector('#fixture-files')!
        .insertAdjacentHTML('beforeend', fileMarkup(files[index], index));
  }
  const viewed = (event.target as HTMLElement).closest('button.MarkAsViewedButton-fixture');
  if (viewed)
    viewed.setAttribute('aria-pressed', String(viewed.getAttribute('aria-pressed') !== 'true'));
});
new EventSource('/__events').addEventListener('message', () => location.reload());
