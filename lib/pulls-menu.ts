/** Octicons (MIT, github.com/primer/octicons), 16px. */
const ICONS = {
  inbox:
    'M2.8 2.06A1.75 1.75 0 0 1 4.41 1h7.18c.7 0 1.333.417 1.61 1.06l2.74 6.395c.04.093.06.194.06.295v4.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25v-4.5c0-.101.02-.202.06-.295Zm1.61.44a.25.25 0 0 0-.23.152L1.887 8H4.75a.75.75 0 0 1 .6.3L6.625 10h2.75l1.275-1.7a.75.75 0 0 1 .6-.3h2.863L11.82 2.652a.25.25 0 0 0-.23-.152Zm10.09 7h-2.875l-1.275 1.7a.75.75 0 0 1-.6.3h-3.5a.75.75 0 0 1-.6-.3L4.375 9.5H1.5v3.75c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25Z',
  smiley:
    'M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm3.82 1.636a.75.75 0 0 1 1.038.175l.007.009c.103.118.22.222.35.31.264.178.683.37 1.285.37.602 0 1.02-.192 1.285-.371.13-.088.247-.192.35-.31l.007-.008a.75.75 0 0 1 1.222.87l-.022-.015c.02.013.021.015.021.015v.001l-.001.002-.002.003-.005.007-.014.019a2.066 2.066 0 0 1-.184.213c-.16.166-.338.316-.53.445-.63.418-1.37.638-2.127.629-.946 0-1.652-.308-2.126-.63a3.331 3.331 0 0 1-.715-.657l-.014-.02-.005-.006-.002-.003v-.002h-.001l.613-.432-.614.43a.75.75 0 0 1 .183-1.044ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM5 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5.25 2.25.592.416a97.71 97.71 0 0 0-.592-.416Z',
  person:
    'M10.561 8.073a6.005 6.005 0 0 1 3.432 5.142.75.75 0 1 1-1.498.07 4.5 4.5 0 0 0-8.99 0 .75.75 0 0 1-1.498-.07 6.004 6.004 0 0 1 3.431-5.142 3.999 3.999 0 1 1 5.123 0ZM10.5 5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z',
  comment:
    'M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z',
  pullRequest:
    'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
  milestone:
    'M7.75 0a.75.75 0 0 1 .75.75V3h3.634c.414 0 .814.147 1.13.414l2.07 1.75a1.75 1.75 0 0 1 0 2.672l-2.07 1.75a1.75 1.75 0 0 1-1.13.414H8.5v5.25a.75.75 0 0 1-1.5 0V10H2.75A1.75 1.75 0 0 1 1 8.25v-3.5C1 3.784 1.784 3 2.75 3H7V.75A.75.75 0 0 1 7.75 0Zm4.384 8.5a.25.25 0 0 0 .161-.06l2.07-1.75a.248.248 0 0 0 0-.38l-2.07-1.75a.25.25 0 0 0-.161-.06H2.75a.25.25 0 0 0-.25.25v3.5c0 .138.112.25.25.25h9.384Z',
  tag: 'M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 7.775Zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z',
} as const;

export interface PullsMenuItem {
  id: string;
  label: string;
  icon: keyof typeof ICONS;
  href: string;
  /** Starts a new group, drawn with a divider above it. */
  group?: boolean;
}

const PERSONAL = [
  {id: 'authored', label: 'Authored by me', icon: 'smiley', qualifier: 'author'},
  {id: 'assigned', label: 'Assigned to me', icon: 'person', qualifier: 'assignee'},
  {id: 'involves', label: 'Involves me', icon: 'comment', qualifier: 'involves'},
  {id: 'review', label: 'Review requests', icon: 'pullRequest', qualifier: 'review-requested'},
] as const;

/** GitHub's own PR sidebar; the personal views only exist when signed in. */
export function pullsMenuItems(owner: string, repo: string, login: string | null): PullsMenuItem[] {
  const base = `/${owner}/${repo}`;
  const search = (qualifier: string): string =>
    `${base}/pulls?${new URLSearchParams({q: `is:pr is:open ${qualifier}:${login}`})}`;
  return [
    {id: 'all', label: 'Pull requests', icon: 'inbox', href: `${base}/pulls`},
    ...(login ? PERSONAL.map(({qualifier, ...item}) => ({...item, href: search(qualifier)})) : []),
    {
      id: 'milestones',
      label: 'Milestones',
      icon: 'milestone',
      href: `${base}/milestones`,
      group: true,
    },
    {id: 'labels', label: 'Labels', icon: 'tag', href: `${base}/labels`},
  ];
}

/** Which view the URL is showing, matching whole query tokens only. */
export function activeMenuItem(
  owner: string,
  repo: string,
  login: string | null,
  pathname: string,
  search: string,
): string | null {
  const base = `/${owner}/${repo}`.toLowerCase();
  const path = pathname.replace(/\/$/, '').toLowerCase();
  if (path === `${base}/milestones` || path.startsWith(`${base}/milestone/`)) return 'milestones';
  if (path === `${base}/labels`) return 'labels';
  if (login && path === `${base}/pulls/@me`) return 'authored';
  if (login && path === `${base}/pulls/assigned/@me`) return 'assigned';
  if (login && path === `${base}/pulls/review-requested/@me`) return 'review';
  if (path !== `${base}/pulls`) return null;
  const tokens = (new URLSearchParams(search).get('q') ?? '').toLowerCase().split(/\s+/);
  const people = ['@me', ...(login ? [login.toLowerCase()] : [])];
  for (const item of PERSONAL)
    if (people.some((person) => tokens.includes(`${item.qualifier}:${person}`))) return item.id;
  return 'all';
}

const TAB_SELECTOR =
  'a#pull-requests-tab, a#pull-requests-repo-tab, nav[aria-label="Repository"] a[href$="/pulls"]';
const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 200;

const svg = (path: string): SVGSVGElement => {
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  icon.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(ns, 'path');
  shape.setAttribute('d', path);
  icon.append(shape);
  return icon;
};

function render(tab: HTMLAnchorElement): HTMLElement | null {
  const [owner, repo] = new URL(tab.href, location.href).pathname.split('/').filter(Boolean);
  if (!owner || !repo) return null;
  const login = document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null;
  const active = activeMenuItem(owner, repo, login, location.pathname, location.search);
  const menu = document.createElement('div');
  menu.className = 'prix-pulls-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Pull request views');
  for (const item of pullsMenuItems(owner, repo, login)) {
    if (item.group) {
      const divider = document.createElement('div');
      divider.className = 'prix-pulls-menu-divider';
      divider.setAttribute('role', 'separator');
      menu.append(divider);
    }
    const link = document.createElement('a');
    link.href = item.href;
    link.setAttribute('role', 'menuitem');
    link.dataset.item = item.id;
    if (item.id === active) link.setAttribute('aria-current', 'page');
    const label = document.createElement('span');
    label.textContent = item.label;
    link.append(svg(ICONS[item.icon]), label);
    menu.append(link);
  }
  return menu;
}

/** One hover menu on GitHub's Pull requests tab; nothing is inserted into GitHub's nav. */
export function watchPullsMenu(signal: AbortSignal): void {
  let menu: HTMLElement | null = null;
  let owner: HTMLAnchorElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const close = (): void => {
    clearTimeout(timer);
    menu?.remove();
    menu = null;
    owner?.removeAttribute('aria-expanded');
    owner = null;
  };
  const open = (tab: HTMLAnchorElement, focusFirst = false): void => {
    clearTimeout(timer);
    if (owner !== tab) {
      close();
      const next = render(tab);
      if (!next) return;
      menu = next;
      owner = tab;
      document.body.append(menu);
    }
    const rect = tab.getBoundingClientRect();
    menu!.style.top = `${rect.bottom + scrollY + 4}px`;
    menu!.style.left = `${Math.max(8, Math.min(rect.left + scrollX, scrollX + innerWidth - menu!.offsetWidth - 8))}px`;
    tab.setAttribute('aria-expanded', 'true');
    if (focusFirst) menu!.querySelector<HTMLElement>('a')?.focus();
  };
  const later = (action: () => void, delay: number): void => {
    clearTimeout(timer);
    timer = setTimeout(action, delay);
  };
  const tabOf = (target: EventTarget | null): HTMLAnchorElement | null =>
    target instanceof Element ? target.closest<HTMLAnchorElement>(TAB_SELECTOR) : null;
  const inside = (target: EventTarget | null): boolean =>
    !!tabOf(target) || (target instanceof Node && !!menu?.contains(target));

  const options = {signal, capture: true};
  document.addEventListener(
    'mouseover',
    (event) => {
      const tab = tabOf(event.target);
      if (tab) later(() => open(tab), menu && owner === tab ? 0 : OPEN_DELAY_MS);
      else if (menu?.contains(event.target as Node)) clearTimeout(timer);
    },
    options,
  );
  document.addEventListener(
    'mouseout',
    (event) => {
      if (!inside(event.target) || inside(event.relatedTarget)) return;
      later(close, CLOSE_DELAY_MS);
    },
    options,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      const tab = tabOf(event.target);
      if (tab && event.key === 'ArrowDown') {
        event.preventDefault();
        open(tab, true);
        return;
      }
      if (!menu?.contains(event.target as Node)) return;
      const links = [...menu.querySelectorAll<HTMLElement>('a')];
      const index = links.indexOf(event.target as HTMLElement);
      if (event.key === 'Escape') {
        const back = owner;
        close();
        back?.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        links[(index + step + links.length) % links.length]?.focus();
      } else if (event.key === 'Tab') close();
    },
    options,
  );
  document.addEventListener(
    'click',
    (event) => {
      if (menu?.contains(event.target as Node)) close();
    },
    options,
  );
  document.addEventListener('turbo:load', close, {signal});
  window.addEventListener('popstate', close, {signal});
  signal.addEventListener('abort', close, {once: true});
}
