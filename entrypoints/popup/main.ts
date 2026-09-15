import './style.css';
import {browser} from 'wxt/browser';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  repoPreferencesKey,
  SETTINGS_KEY,
  type GlobalSettings,
} from '../../lib/preferences';
import {DEFAULT_CONFIG} from '../../lib/config';
import {actionToState, type DisplayState} from '../../lib/state';

const checkbox = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const status = document.getElementById('settings-status')!;
const categories = [...DEFAULT_CONFIG.rules.map((rule) => rule.name), 'code'];
const selects = new Map<string, HTMLSelectElement>();
let settings: GlobalSettings;
let repository: string | null = null;
let saving = Promise.resolve();

function render(): void {
  checkbox('enabled').checked = settings.enabled;
  checkbox('unreviewed').checked = settings.unreviewed;
  checkbox('exclude-comments').checked = settings.excludeComments;
  for (const [category, select] of selects) select.value = settings.defaultStates[category] ?? '';
}

async function save(): Promise<void> {
  const snapshot = structuredClone(settings);
  saving = saving.catch(() => {}).then(() => browser.storage.local.set({[SETTINGS_KEY]: snapshot}));
  try {
    await saving;
    status.textContent = 'Saved. Open GitHub pages update automatically.';
  } catch {
    status.textContent = 'Couldn’t save settings. Reload the extension and try again.';
  }
}

async function init(): Promise<void> {
  settings = await loadSettings();
  for (const category of categories) {
    const label = document.createElement('label');
    label.className = 'settings-category';
    const name = document.createElement('span');
    name.textContent = category;
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Default visibility for ${category}`);
    const fallback = actionToState(
      DEFAULT_CONFIG.rules.find((rule) => rule.name === category)?.action ?? 'visible',
    );
    select.append(
      new Option(`Repository rule (${fallback})`, ''),
      new Option('Expanded', 'visible'),
      new Option('Collapsed', 'collapsed'),
      new Option('Hidden', 'hidden'),
    );
    selects.set(category, select);
    label.append(name, select);
    document.getElementById('category-defaults')!.append(label);
  }
  render();
  document.getElementById('settings')!.addEventListener('change', () => {
    settings = {
      enabled: checkbox('enabled').checked,
      unreviewed: checkbox('unreviewed').checked,
      excludeComments: checkbox('exclude-comments').checked,
      defaultStates: Object.fromEntries(
        [...selects]
          .filter(([, select]) => select.value)
          .map(([name, select]) => [name, select.value as DisplayState]),
      ),
    };
    void save();
  });
  document.getElementById('reset-defaults')!.addEventListener('click', () => {
    settings = structuredClone(DEFAULT_SETTINGS);
    render();
    void save();
  });
  try {
    const [tab] = await browser.tabs.query({active: true, currentWindow: true});
    const url = tab?.url ? new URL(tab.url) : null;
    const match =
      url?.hostname === 'github.com' ? /^\/([^/]+)\/([^/]+)(?:\/|$)/.exec(url.pathname) : null;
    if (match) repository = `${match[1]}/${match[2]}`;
  } catch {
    /* Global settings remain available outside a GitHub tab. */
  }
  const requested = new URLSearchParams(location.search).get('repo');
  if (requested && /^[\w.-]+\/[\w.-]+$/.test(requested)) repository = requested;
  if (repository) {
    document.getElementById('repository-title')!.textContent = repository;
    (document.getElementById('reset-repo') as HTMLButtonElement).disabled = false;
  }
  document.getElementById('reset-repo')!.addEventListener('click', () => {
    if (!repository) return;
    void browser.storage.local
      .remove([repoPreferencesKey(repository), `prix:categoryStates:${repository}`])
      .then(() => {
        status.textContent = `Reset preferences for ${repository}.`;
      })
      .catch(() => {
        status.textContent = 'Couldn’t reset this repository. Try again.';
      });
  });
}
void init().catch(() => {
  status.textContent = 'Couldn’t load settings. Reload the extension and try again.';
});
