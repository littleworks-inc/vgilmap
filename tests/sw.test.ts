import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { offlineMessage } from '../src/utils/offline';

/** Runs public/sw.js against a fake cache, network and event system. */
function boot(opts: { online: boolean; html?: string }) {
  const store = new Map<string, Response>();
  const storedOrigin = new Map<string, string | null>(); // the Origin header each entry was fetched with
  const listeners: Record<string, (e: unknown) => void> = {};
  const fetched: string[] = [];
  const state = { online: opts.online };
  const key = (r: Request | string) => new URL(typeof r === 'string' ? r : r.url, 'https://vigil.test').href;
  const caches = {
    open: async () => ({
      // Like the real Cache: a response that says "Vary: Origin" only matches a request with the same Origin
      // header (module scripts send one; a plain fetch does not) unless the lookup passes ignoreVary.
      match: async (r: Request | string, o: { ignoreVary?: boolean } = {}) => {
        const hit = store.get(key(r)); if (!hit) return undefined;
        const asked = typeof r === 'string' ? null : r.headers.get('origin');
        if (!o.ignoreVary && /origin/i.test(hit.headers.get('vary') ?? '') && storedOrigin.get(key(r)) !== asked) return undefined;
        return hit.clone();
      },
      put: async (r: Request | string, res: Response) => { store.set(key(r), res); storedOrigin.set(key(r), typeof r === 'string' ? null : r.headers.get('origin')); },
      add: async (r: string) => { const res = await doFetch(r); if (!res.ok) throw new Error('bad'); store.set(key(r), res); storedOrigin.set(key(r), null); },
      keys: async () => [...store.keys()].map(u => new Request(u)),
      delete: async (r: Request) => store.delete(key(r)),
    }),
    keys: async () => ['vigil-shell-v1', 'old-cache'],
    delete: async () => true,
  };
  async function doFetch(r: Request | string): Promise<Response> {
    const url = key(r); fetched.push(url);
    if (!state.online) throw new TypeError('Failed to fetch');
    const p = new URL(url).pathname;
    if (p === '/') return new Response(opts.html ?? '<script src="/assets/app-1.js"></script><link href="/assets/app-1.css" rel="stylesheet">');
    return new Response(`body of ${p}`, { headers: { Vary: 'Origin' } }); // as the real server sends
  }
  const self = { location: { origin: 'https://vigil.test' }, addEventListener: (n: string, f: (e: unknown) => void) => { listeners[n] = f; }, skipWaiting: () => {}, clients: { claim: async () => {} } };
  vm.runInNewContext(readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8'), {
    self, caches, fetch: doFetch, URL, Request, Response, Promise, Set, setTimeout, console,
  });
  /** Dispatches a fetch event; returns the response, or null if the worker left it to the network. */
  async function request(url: string, init: { mode?: string; method?: string; origin?: boolean } = {}) {
    const req = new Request(new URL(url, 'https://vigil.test').href, { method: init.method ?? 'GET', headers: init.origin ? { Origin: 'https://vigil.test' } : {} });
    Object.defineProperty(req, 'mode', { value: init.mode ?? 'no-cors' });
    let responded: Promise<Response> | null = null;
    listeners.fetch({ request: req, respondWith: (p: Promise<Response>) => { responded = p; } });
    return responded ? await (responded as Promise<Response>) : null;
  }
  const install = async () => { let p: Promise<unknown> = Promise.resolve(); listeners.install({ waitUntil: (x: Promise<unknown>) => { p = x; } }); await p; };
  return { request, install, state, store, fetched };
}

describe('service worker: the app shell, and nothing live', () => {
  let sw: ReturnType<typeof boot>;
  beforeEach(async () => { sw = boot({ online: true }); await sw.install(); });

  it('never touches /api, other origins or non-GET requests (live data and map tiles stay on the network)', async () => {
    expect(await sw.request('/api/v1/events?limit=1')).toBeNull();
    expect(await sw.request('https://tiles.example.com/9/1/2.png')).toBeNull();
    expect(await sw.request('/api/firms', { method: 'POST' })).toBeNull();
    expect([...sw.store.keys()].some(u => u.includes('/api/'))).toBe(false);
  });
  it('leaves other pages (the API docs) to the network', async () => {
    expect(await sw.request('/api-docs.html', { mode: 'navigate' })).toBeNull();
  });
  it('install stores the shell, its scripts and styles, so it opens offline right after a first visit', () => {
    const urls = [...sw.store.keys()].map(u => new URL(u).pathname);
    expect(urls).toEqual(expect.arrayContaining(['/', '/assets/app-1.js', '/assets/app-1.css', '/manifest.webmanifest', '/icons/icon-192.png']));
  });
  it('offline, opening the app serves the cached shell', async () => {
    sw.state.online = false;
    const res = await sw.request('/?view=today', { mode: 'navigate' });
    expect(await res!.text()).toContain('/assets/app-1.js');
  });
  it('online, opening the app gets the newest page, and remembers it', async () => {
    const next = boot({ online: true, html: '<script src="/assets/app-2.js"></script>' });
    await next.install();
    const res = await next.request('/', { mode: 'navigate' });
    expect(await res!.text()).toContain('app-2.js');
    expect(await (await next.store.get('https://vigil.test/')!.clone().text())).toContain('app-2.js');
  });
  it('hashed assets are served from the cache without asking the network again', async () => {
    const before = sw.fetched.length;
    const res = await sw.request('/assets/app-1.js');
    expect(await res!.text()).toBe('body of /assets/app-1.js');
    expect(sw.fetched.length).toBe(before);
  });
  it('...even for a module script, which sends an Origin header the precache did not (this left the app blank offline)', async () => {
    sw.state.online = false;
    const res = await sw.request('/assets/app-1.js', { origin: true });
    expect(await res!.text()).toBe('body of /assets/app-1.js');
  });
  it('offline with nothing cached fails, rather than inventing a page', async () => {
    const empty = boot({ online: false });
    await expect(empty.request('/', { mode: 'navigate' })).rejects.toThrow();
  });
});

describe('offline wording never claims the data is current', () => {
  it('says how old the data is, and that alerts may have changed', () => {
    const msg = offlineMessage(new Date(2026, 10, 22, 21, 5));
    expect(msg).toMatch(/^Offline: showing data from .*9:05/);
    expect(msg).toMatch(/may have changed or ended/);
  });
  it('with nothing loaded yet, says live data cannot load', () => {
    expect(offlineMessage(null)).toMatch(/live data can.t load/);
  });
});
