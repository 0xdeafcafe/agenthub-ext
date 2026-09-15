/** Local preview only. Production builds continue to use wxt/browser. */
type Changes = Record<string, {oldValue?: unknown; newValue?: unknown}>;
const listeners = new Set<(changes: Changes, area: string) => void>();
const emit = (changes: Changes): void => {
  for (const listener of listeners) listener(changes, 'local');
};
const storageKey = (key: string): string => `preview:${key}`;
window.addEventListener('storage', (event) => {
  if (event.key?.startsWith('preview:'))
    emit({
      [event.key.slice(8)]: {
        oldValue: JSON.parse(event.oldValue ?? 'null'),
        newValue: JSON.parse(event.newValue ?? 'null'),
      },
    });
});
export const browser = {
  permissions: {
    async request(): Promise<boolean> {
      return true;
    },
    async contains(): Promise<boolean> {
      return true;
    },
  },
  runtime: {
    id: 'prix-local-preview',
    getURL: (path: string): string =>
      `${location.origin}${path.startsWith('/') ? path : '/' + path}`,
    async sendMessage(): Promise<unknown> {
      return {inventory: null};
    },
  },
  tabs: {
    async query(): Promise<Array<{url: string}>> {
      return [{url: 'https://github.com/acme/review-kit/pull/42/files'}];
    },
  },
  storage: {
    onChanged: {
      addListener: (listener: (changes: Changes, area: string) => void): void => {
        listeners.add(listener);
      },
      removeListener: (listener: (changes: Changes, area: string) => void): void => {
        listeners.delete(listener);
      },
    },
    local: {
      async get(keys: string | string[]): Promise<Record<string, unknown>> {
        return Object.fromEntries(
          (typeof keys === 'string' ? [keys] : keys).map((key) => [
            key,
            JSON.parse(localStorage.getItem(storageKey(key)) ?? 'null'),
          ]),
        );
      },
      async set(entries: Record<string, unknown>): Promise<void> {
        const changes: Changes = {};
        for (const [key, value] of Object.entries(entries)) {
          changes[key] = {
            oldValue: JSON.parse(localStorage.getItem(storageKey(key)) ?? 'null'),
            newValue: value,
          };
          localStorage.setItem(storageKey(key), JSON.stringify(value));
        }
        queueMicrotask(() => emit(changes));
      },
      async remove(keys: string | string[]): Promise<void> {
        const changes: Changes = {};
        for (const key of typeof keys === 'string' ? [keys] : keys) {
          changes[key] = {oldValue: JSON.parse(localStorage.getItem(storageKey(key)) ?? 'null')};
          localStorage.removeItem(storageKey(key));
        }
        queueMicrotask(() => emit(changes));
      },
    },
  },
};
