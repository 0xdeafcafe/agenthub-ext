import './preview.css';

type Fixture = {path: string; added: number; removed: number};
import initialFiles from './files.json';
let files = [...initialFiles];
const escape = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const idFor = (i: number): string => `diff-${(i + 1).toString(16).padStart(32, '0')}`;
const isReact = (): boolean => location.pathname.includes('/changes');

function fileMarkup(file: Fixture, i: number): string {
  const header = isReact() ? 'DiffFileHeader-module__diff-file-header__fixture' : 'file-header';
  return `<div class="fixture-slot"><div id="${idFor(i)}" class="fixture-file ${isReact() ? '' : 'js-file'}" data-tagsearch-path="${escape(file.path)}">
    <div class="${header} fixture-file-header" data-path="${escape(file.path)}">
      <span aria-hidden="true">⌄</span>
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

function render(): void {
  document.querySelector('#fixture-root')!.innerHTML = `
    <header class="fixture-global"><span class="fixture-logo">◈</span><span>acme <span class="fixture-muted">/</span> <strong>review-kit</strong></span><span class="fixture-private">Public</span></header>
    <nav aria-label="Repository"><ul class="fixture-repo-nav"><li><a href="#">Code</a></li><li><a href="#">Issues <span class="Counter">12</span></a></li><li><a id="pull-requests-tab" class="selected" href="/acme/review-kit/pulls"><span data-content="Pull requests">Pull requests</span><span class="Counter">8</span></a></li><li><a href="#">Actions</a></li></ul></nav>
    <main><div class="fixture-page">
    <div class="fixture-pr-heading"><div class="fixture-eyebrow">PULL REQUEST</div><h1>Make every review count <span>#42</span></h1><p><span class="fixture-open">⤴ Open</span> <strong>alex</strong> wants to merge 4 commits into <code>main</code> from <code>feature/review-focus</code></p></div>
    <div class="fixture-pr-tabs"><a href="#">Conversation <span>3</span></a><a href="/acme/review-kit/pull/42/commits">Commits <span>4</span></a><a class="selected" href="${location.pathname}">Files changed <span>${files.length}</span></a></div>
    <section class="pr-toolbar"><span><strong>Changes</strong><span class="fixture-muted"> · All commits</span></span><button type="button">Review changes</button></section>
    <div class="fixture-workspace">${treeMarkup()}<div id="fixture-files">${(new URLSearchParams(location.search).get('scenario') === 'virtualized' ? files.slice(0, 3) : files).map(fileMarkup).join('')}</div></div>
    </div></main>`;
}

const harness = {
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
  const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
    '.fixture-tree a[href^="#diff-"]',
  );
  if (anchor && !document.getElementById(anchor.hash.slice(1))) {
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
