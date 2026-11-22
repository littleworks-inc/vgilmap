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
  properties: { id: `a${i}`, areaDesc: 'County', status: 'Actual', messageType: 'Alert', severity: 'Moderate', certainty: 'Likely', urgency: 'Expected', event: 'Wind Advisory', headline: 'Wind', description: '', instruction: null, sent: new Date(Date.now() - 60_000).toISOString(), effective: new Date().toISOString(), expires: new Date(Date.now() + 86_400_000).toISOString(), ends: null, onset: null, category: 'Met', response: '', affectedZones: [], parameters: {} },
});

let usgsUp = true;
function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('all_day.geojson')) {
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

beforeEach(() => { usgsUp = true; mockFetch(); });
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('/api/v1/events (end to end, mocked upstreams)', () => {
  it('serves the whole dataset and reports every source, even when most are down', async () => {
    const { res, body } = await get('/api/v1/events?limit=10&source=usgs-day,noaa,cyber,who');
    expect(res.status).toBe(200);
    const status = Object.fromEntries(body.sources.map((s: SourceStatus) => [s.key, s.status]));
    expect(status['usgs-day']).toBe('ok');
    expect(status['noaa']).toBe('ok');
    expect(status['who']).toBe('error');
    expect(status['cyber']).toBe('error');
  });

  it('totals and summary cover every matching event, not just the returned page', async () => {
    const { body } = await get('/api/v1/events?source=usgs-day,noaa&limit=10');
    expect(body.count).toBe(10);
    expect(body.total).toBe(153);            // 150 quakes + 3 NOAA alerts
    expect(body.summary.total).toBe(153);
    expect(body.summary.by_domain).toEqual({ disaster: 150, climate: 3 });
    expect(body.next_offset).toBe(10);
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

  it('exposes one definition for every source', () => {
    expect(SOURCE_META.map(s => s.key)).toHaveLength(13);
    for (const s of SOURCE_META) expect(s.refreshSeconds).toBeGreaterThan(0);
  });
});
