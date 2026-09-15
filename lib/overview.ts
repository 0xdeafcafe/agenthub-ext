import {classify, compileRules} from './classifier';
import {fetchConfig} from './config';
import {ChangeMap} from './change-map';
import {FileIndex, adjustedLines} from './file-index';
import {categoryColor} from './impact-bar';
import {fetchInventory} from './inventory';
import {ReviewPreferences} from './preferences';
import {fileAnchor, pullHeaderPlacement, readPrTotals, type PrTotals} from './pr-page';
import {rafThrottled} from './safe';

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};

/** The conversation page summarizes the whole PR; diff controls belong beside the code. */
export async function initOverview(
  owner: string,
  repo: string,
  pr: string,
  signal: AbortSignal,
): Promise<void> {
  const inventoryRequest = fetchInventory(new URL(location.href), signal);
  const preferences = new ReviewPreferences(`${owner}/${repo}`);
  const configRequest = Promise.all([fetchConfig(owner, repo), preferences.load(signal)]);
  const panel = element('section', 'prix-bar prix-overview');
  panel.id = 'prix-bar';
  panel.setAttribute('aria-label', 'Pull request change summary');
  const header = element('div', 'prix-overview-header');
  const title = element('strong', 'prix-overview-title', 'Changes at a glance');
  const totals = element('span', 'prix-totals', 'Loading PR totals…');
  const stats = element('span', 'prix-overview-stats');
  const added = element('span', 'prix-added');
  const removed = element('span', 'prix-removed');
  stats.append(added, removed);
  const link = element('a', 'prix-open-changes', 'Review changes →');
  const changesUrl = (): URL => {
    const native = document.querySelector<HTMLAnchorElement>(
      `a[href^="/${owner}/${repo}/pull/${pr}/changes"], a[href^="/${owner}/${repo}/pull/${pr}/files"]`,
    );
    return new URL(native?.href ?? `/${owner}/${repo}/pull/${pr}/changes`, location.origin);
  };
  link.href = changesUrl().href;
  header.append(title, totals, stats, link);
  const track = element('div', 'prix-bar-track');
  track.hidden = true;
  track.setAttribute('aria-hidden', 'true');
  const legend = element('div', 'prix-overview-legend');
  legend.setAttribute('aria-label', 'Share of changed lines by category');
  const coverage = element('div', 'prix-coverage', 'Loading category breakdown…');
  coverage.setAttribute('role', 'status');
  const map = new ChangeMap(
    (path) => {
      const url = changesUrl();
      void fileAnchor(path)
        .then((hash) => {
          if (!signal.aborted) {
            url.hash = hash;
            location.assign(url);
          }
        })
        .catch(() => {
          coverage.textContent = 'Open Changes to review this file.';
        });
    },
    () => {},
    signal,
    false,
  );
  map.element.hidden = true;
  panel.append(header, track, legend, coverage, map.element);
  let complete = false;
  let totalsSignature = '';
  const showTotals = (counts: PrTotals): void => {
    const signature = JSON.stringify(counts);
    if (signature === totalsSignature) return;
    totalsSignature = signature;
    totals.textContent = `${counts.files} files · ${counts.added + counts.removed} lines`;
    added.textContent = `+${counts.added.toLocaleString()}`;
    removed.textContent = `−${counts.removed.toLocaleString()}`;
  };
  const mount = rafThrottled(() => {
    if (!panel.isConnected) {
      const placement = pullHeaderPlacement();
      if (placement) placement.parent.insertBefore(panel, placement.before);
    }
    const href = changesUrl().href;
    if (link.href !== href) link.href = href;
    if (!complete) {
      const counts = readPrTotals(document);
      if (counts) showTotals(counts);
    }
  }, signal);
  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, {childList: true, subtree: true, characterData: true});
  signal.addEventListener(
    'abort',
    () => {
      observer.disconnect();
      panel.remove();
    },
    {once: true},
  );
  mount();
  const [result, [config]] = await Promise.all([inventoryRequest, configRequest]);
  if (signal.aborted) return;
  if (!result.inventory?.complete) {
    coverage.textContent = 'Category breakdown and map unavailable · showing GitHub totals';
    return;
  }
  complete = true;
  const files = result.inventory.files;
  const rules = compileRules(config.rules);
  const categories = [...new Set([...rules.map((rule) => rule.name), 'code'])];
  const index = new FileIndex();
  const render = (): void => {
    index.seed(files, (path) => {
      const override = preferences.repo.classifications[path];
      return categories.includes(override) ? override : classify(path, rules);
    });
    const counts = index.countsFor(preferences.excludeComments);
    const all = [...counts.values()].reduce(
      (sum, count) => ({
        files: sum.files + count.files,
        added: sum.added + count.added,
        removed: sum.removed + count.removed,
      }),
      {files: 0, added: 0, removed: 0},
    );
    showTotals(all);
    track.replaceChildren();
    legend.replaceChildren();
    for (const [i, name] of categories.entries()) {
      const count = counts.get(name);
      if (!count?.files) continue;
      const lines = count.added + count.removed;
      const percent = Math.round((lines / (all.added + all.removed || 1)) * 100);
      const color = categoryColor(name, i);
      const segment = element('span', 'prix-segment');
      segment.style.background = color;
      segment.style.flexGrow = String(lines);
      track.append(segment);
      const item = element('span', 'prix-overview-category');
      item.dataset.category = name;
      item.title = `${count.files} files · ${lines.toLocaleString()} changed lines`;
      const dot = element('span', 'prix-overview-dot');
      dot.style.background = color;
      const share = element('strong', '', `${percent}%`);
      item.append(dot, name, share);
      legend.append(item);
    }
    track.hidden = false;
    coverage.textContent = `Complete PR inventory · ${all.files} files${preferences.excludeComments ? ' · comment-only lines excluded' : ''}`;
    map.element.hidden = false;
    map.update(
      [...index.files].map(([path, file]) => ({
        path,
        category: file.category,
        ...adjustedLines(file, preferences.excludeComments),
        viewed: false,
        state: 'visible',
      })),
    );
  };
  preferences.subscribe(render);
  render();
}
