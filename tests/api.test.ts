import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOURCE_META } from '../shared/pipeline/sources';
import type { EventsResponse } from '../shared/pipeline/query';
import type { SourceStatus } from '../shared/pipeline/engine';
import type { VigilEvent } from '../shared/types';

interface SummaryBody { total_events: number; by_domain: Record<string, number> }

/** Mock only the upstreams we care about; every other source fails like a real outage would. */
const quake = (i: number) => ({ id: `q${i}`, properties: { time: Date.now() - 60_000 - i * 1000, mag: i < 3 ? 6.5 : 3, title: `M quake ${i}`, place: '10 km N of Somewhere', url: 'https://usgs.example/q', type: 'earthquake', tsunami: 0 }, geometry: { coordinates: [1, 2, 10] } });
const alertFeature = (i: number, withGeometry: boolean) => ({
  type: 'Feature', id: `a${i}`,
  geometry: withGeometry ? { type: 'Polygon', coordinates: [[[-90, 30], [-88, 30], [-88, 32], [-90, 30]]] } : null,
  properties: { id: `a${i}`, areaDesc: 'County', status: 'Actual', messageType: 'Alert', severity: 'Moderate', certainty: 'Likely', urgency: 'Expected', event: 'Wind Advisory', headline: 'Wind', description: '', instruction: null, sent: new Date(Date.now() - 60_000).toISOString(), effective: new Date().toISOString(), expires: new Date(Date.now() + alertEndsInS * 1000).toISOString(), ends: null, onset: null, category: 'Met', response: '', affectedZones: [], parameters: {} },
});

let usgsUp = true;
let alertEndsInS = 86_400; // when the mocked NOAA alerts end, seconds from now
let usgsCalls = 0;
let whoCalls = 0;
function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('who.int')) { whoCalls++; }
    if (url.includes('who.int')) return new Response(JSON.stringify({ value: [{ Title: 'Cholera - Somewhere', UrlName: 'cholera-somewhere', PublicationDateAndTime: new Date().toISOString(), Summary: '' }] }));
    if (url.includes('all_day.geojson')) {
      usgsCalls++;
      return usgsUp ? new Response(JSON.stringify({ features: Array.from({ length: 150 }, (_, i) => quake(i)) })) : new Response('down', { status: 503 });
    }
    if (url.includes('api.weather.gov')) return new Response(JSON.stringify({ features: [alertFeature(1, true), alertFeature(2, false), alertFeature(3, false)] }));
    return new Response('upstream down', { status: 503 });
  }));
}

// Import after the mock helpers exist; handlers read fetch at call time.
async function get<T = EventsResponse>(path: string): Promise<{ res: Response; body: T }> {
  const { default: events } = await import('../api/v1/events');
  const { default: summary } = await import('../api/v1/summary');
  const handler = path.startsWith('/api/v1/summary') ? summary : events;
  const res = await handler(new Request(`http://localhost${path}`));
  return { res, body: (await res.json()) as T };
}

beforeEach(() => { alertEndsInS = 86_400; usgsUp = true; usgsCalls = 0; whoCalls = 0; mockFetch(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('/api/v1/events (end to end, mocked upstreams)', () => {
  it('serves the whole dataset and reports every source, even when most are down', async () => {
    const { res, body } = await get('/api/v1/events?limit=10&source=usgs-day,noaa,cyber,reliefweb');
    expect(res.status).toBe(200);
    const status = Object.fromEntries(body.sources.map((s: SourceStatus) => [s.key, s.status]));
    expect(status['usgs-day']).toBe('ok');
    expect(status['noaa']).toBe('ok');
    expect(status['reliefweb']).toBe('error');
    expect(status['cyber']).toBe('error');
  });

  it('totals and summary cover every matching event, not just the returned page', async () => {
    const { body } = await get('/api/v1/events?source=usgs-day,noaa&limit=10');
    expect(body.count).toBe(10);
    expect(body.total).toBe(153);            // 150 quakes + 3 NOAA alerts
    expect(body.summary.total).toBe(153);
    expect(body.summary.by_domain).toEqual({ disaster: 150, climate: 3 });
    expect(body.next_cursor).toEqual(expect.any(String));
    const sum = await get<SummaryBody>('/api/v1/summary?source=usgs-day,noaa');
    expect(sum.body.total_events).toBe(153); // the summary endpoint agrees (it used to count only a 100-event page)
    expect(sum.body.by_domain).toEqual({ disaster: 150, climate: 3 });
  });

  it('keeps NOAA alerts without geometry as list-only events, with unknown precision', async () => {
    const { body } = await get('/api/v1/events?source=noaa&limit=10');
    expect(body.total).toBe(3);
    const nomap = await get('/api/v1/events?source=noaa&location=nomap');
    expect(nomap.body.total).toBe(2);
    expect(nomap.body.data.every((e: VigilEvent) => e.location.precision === 'unknown')).toBe(true);
    const map = await get('/api/v1/events?source=noaa&location=map');
    expect(map.body.data[0].location.precision).toBe('area');
  });

  it('reports precision and coverage for each source', async () => {
    const { body } = await get('/api/v1/events?source=usgs-day,noaa&limit=1');
    const by = Object.fromEntries(body.sources.map((s: SourceStatus) => [s.key, s]));
    expect(by['usgs-day'].precision).toBe('exact');
    expect(by['noaa'].coverage).toMatch(/United States/);
  });

  it('serves the last good data, flagged retained, when a source goes down (and 503s only when there is nothing)', async () => {
    const first = await get('/api/v1/events?source=usgs-day&limit=1');
    expect(first.body.total).toBe(150);
    usgsUp = false;
    // Within the refresh interval the fresh snapshot is served as-is; once it is older, upstream is asked again.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 5 * 60_000 });
    const second = await get('/api/v1/events?source=usgs-day&limit=1');
    expect(second.res.status).toBe(200);
    expect(second.body.total).toBe(150);
    expect(second.body.sources[0]).toMatchObject({ status: 'error', retained: true, count: 150 });
    expect(second.res.headers.get('cache-control')).toMatch(/s-maxage=30\b/); // degraded: short cache so recovery is quick

    vi.resetModules(); // a fresh instance with no last-good copy
    const cold = await get('/api/v1/events?source=usgs-day');
    expect(cold.res.status).toBe(503);
    expect(cold.res.headers.get('cache-control')).toBe('no-store');
  });

  it('leaves optional sources out of whole-dataset requests unless asked for', async () => {
    const { runPipeline } = await import('../api/_lib/pipeline');
    const { MemoryStore } = await import('../shared/pipeline/engine');
    const { ev, loader } = await import('./helpers');
    const loaders = [
      loader('core', () => ({ events: [ev('1')], warnings: [] })),
      loader('extra', () => ({ events: [ev('2')], warnings: [] }), { optional: true }),
    ];
    const keys = async (qs: string) => (await runPipeline(new URLSearchParams(qs), { loaders, store: new MemoryStore() })).body.sources.map(s => s.key);
    expect(await keys('')).toEqual(['core']);
    expect(await keys('source=extra')).toEqual(['extra']);
    expect(await keys('optional=1')).toEqual(['core', 'extra']);
  });

  describe('invalid requests are rejected, not silently widened', () => {
    it.each([
      ['source=typo', /Unknown source "typo"/],
      ['domain=nope', /Unknown domain "nope"/],
      ['severity=urgent', /Unknown severity/],
      ['since=yesterday', /Invalid "since"/],
      ['limit=lots', /Invalid "limit"/],
      ['cursor=!!!', /Invalid "cursor"/],
      ['offset=5', /cursor/],
      ['limit=0', /Invalid "limit"/],
      ['limit=1001', /Invalid "limit"/],
      ['since=2026-02-30', /Invalid "since"/],
      ['source=', /is empty/],
      ['domain=,', /is empty/],
    ])('%s → 400', async (qs, message) => {
      for (const path of ['/api/v1/events', '/api/v1/summary']) {
        const { res, body } = await get<{ ok: boolean; error: string; valid?: string[] }>(`${path}?${qs}`);
        expect(res.status).toBe(400);
        expect(body.ok).toBe(false);
        expect(body.error).toMatch(message);
        expect(res.headers.get('cache-control')).toBe('no-store');
      }
    });
    it('lists the valid source keys', async () => {
      const { body } = await get<{ valid: string[] }>('/api/v1/events?source=typo');
      expect(body.valid).toEqual(expect.arrayContaining(['usgs-day', 'who', 'cyber']));
    });
  });

  describe('caching follows the source definitions', () => {
    it('caches each source for its own refresh interval (no five-minute cap)', async () => {
      const who = await get('/api/v1/events?source=who');
      expect(who.res.status).toBe(200);
      expect(who.res.headers.get('cache-control')).toMatch(/s-maxage=(3599|3600)\b/);
      const quakes = await get('/api/v1/events?source=usgs-day');
      expect(quakes.res.headers.get('cache-control')).toMatch(/s-maxage=(119|120)\b/);
    });
    it('caches an old snapshot only for the freshness it has LEFT, never a whole new interval', async () => {
      const t0 = Date.now();
      vi.useFakeTimers({ toFake: ['Date'], now: t0 });
      const first = await get('/api/v1/events?source=who');
      expect(first.res.headers.get('cache-control')).toMatch(/s-maxage=3600\b/);

      vi.setSystemTime(t0 + 3_599_000); // the snapshot is 3599s old; a different query asks for it
      const second = await get('/api/v1/events?source=who&limit=1');
      expect(whoCalls).toBe(1);                                   // same snapshot, no new fetch
      expect(second.res.headers.get('cache-control')).toMatch(/s-maxage=1\b/); // was 3600: up to ~2h of staleness
      expect(second.res.headers.get('cache-control')).toMatch(/stale-while-revalidate=1\b/);

      vi.setSystemTime(t0 + 3_601_000); // past the interval: refetched, and a full interval again
      const third = await get('/api/v1/events?source=who&limit=2');
      expect(whoCalls).toBe(2);
      expect(third.res.headers.get('cache-control')).toMatch(/s-maxage=3600\b/);
    });
    it('never caches a response past the moment an alert in it ends', async () => {
      alertEndsInS = 90; // NOAA refreshes every 300s, but these alerts end in 90s
      const { res, body } = await get('/api/v1/events?source=noaa');
      expect(body.next_expiry).not.toBeNull();
      const ttl = Number(/s-maxage=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1]);
      expect(ttl).toBeLessThanOrEqual(90);
      expect(ttl).toBeGreaterThan(60);
    });
    it('hides alerts after they end, even from a cached snapshot, and shows them with lifecycle=all', async () => {
      const t0 = Date.now();
      vi.useFakeTimers({ toFake: ['Date'], now: t0 });
      alertEndsInS = 120;
      const live = await get('/api/v1/events?source=noaa');
      expect(live.body.total).toBe(3);
      vi.setSystemTime(t0 + 150_000); // the alerts ended 30s ago; the 300s snapshot is still cached
      const later = await get('/api/v1/events?source=noaa');
      expect(later.body.total).toBe(0);
      expect(later.body.total_expired).toBe(3);
      const all = await get('/api/v1/events?source=noaa&lifecycle=all');
      expect(all.body.data.every(e => e.lifecycle === 'expired')).toBe(true);
    });
    it('a mixed request is limited by the source with the least freshness left', async () => {
      const t0 = Date.now();
      vi.useFakeTimers({ toFake: ['Date'], now: t0 });
      await get('/api/v1/events?source=usgs-day');                 // refreshes every 120s
      vi.setSystemTime(t0 + 100_000);                              // 20s of its freshness remain
      const { res } = await get('/api/v1/events?source=who,usgs-day');
      expect(res.headers.get('cache-control')).toMatch(/s-maxage=20\b/);
    });
    it('a mixed request uses its fastest-refreshing source', async () => {
      const { res } = await get('/api/v1/events?source=who,usgs-day');
      expect(res.headers.get('cache-control')).toMatch(/s-maxage=(119|120)\b/);
    });
    it('different filters and pages reuse one upstream snapshot instead of refetching', async () => {
      const first = await get('/api/v1/events?source=usgs-day&limit=50');
      await get('/api/v1/events?source=usgs-day&limit=10&severity=high');
      await get(`/api/v1/events?source=usgs-day&limit=50&cursor=${first.body.next_cursor}`);
      await get('/api/v1/summary?source=usgs-day');
      expect(usgsCalls).toBe(1);
    });
    it('concurrent requests share a single upstream fetch', async () => {
      await Promise.all([1, 2, 3, 4].map(() => get('/api/v1/events?source=usgs-day&limit=5')));
      expect(usgsCalls).toBe(1);
    });
  });

  it('pages of one dataset never mix snapshots: walking every page returns each event once', async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const { body }: { body: EventsResponse } = await get(`/api/v1/events?source=usgs-day&limit=40${cursor ? `&cursor=${cursor}` : ''}`);
      ids.push(...body.data.map(e => e.id));
      cursor = body.next_cursor;
    } while (cursor);
    expect(ids).toHaveLength(150);
    expect(new Set(ids).size).toBe(150);
  });

  it('exposes one definition for every source', () => {
    expect(SOURCE_META.map(s => s.key)).toHaveLength(13);
    for (const s of SOURCE_META) expect(s.refreshSeconds).toBeGreaterThan(0);
  });
});
