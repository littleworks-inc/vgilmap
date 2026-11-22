import { describe, expect, it } from 'vitest';
import { MemoryStore, runSources } from '../shared/pipeline/engine';
import { buildEventsResponse, filterEvents, mergeEvents, paginate, parseQuery, summarize } from '../shared/pipeline/query';
import { isMappable } from '../shared/types';
import { ev, loader, NOW } from './helpers';

const q = (s = '') => parseQuery(new URLSearchParams(s));
const unlocated = (id: string) => ev(id, { domain: 'cyber', location: { lat: 0, lng: 0, country: 'Global', region: '', label: 'Global' }, metadata: { unlocated: true } });

describe('parseQuery', () => {
  it('defaults and clamps pagination', () => {
    expect(q()).toMatchObject({ limit: 100, offset: 0, location: 'all' });
    expect(q('limit=99999').limit).toBe(1000);
    expect(q('limit=0').limit).toBe(1);
    expect(q('limit=abc').limit).toBe(100);
    expect(q('offset=-5').offset).toBe(0);
  });
  it('ignores unknown domains and bad dates', () => {
    expect(q('domain=cyber,nonsense').domains).toEqual(['cyber']);
    expect(q('domain=nonsense').domains).toBeUndefined();
    expect(q('since=garbage').since).toBeUndefined();
  });
});

describe('mergeEvents: deduplication', () => {
  it('keeps one copy of an id that two sources both return (first source wins), newest first', () => {
    const merged = mergeEvents([
      { events: [ev('1', { source: 'A' }), ev('3')] },
      { events: [ev('1', { source: 'B' }), ev('2')] },
    ]);
    expect(merged.map(e => e.id)).toEqual(['1', '2', '3']);
    expect(merged.find(e => e.id === '1')?.source).toBe('A');
  });
});

describe('unlocated events', () => {
  it('are kept in the dataset, marked unknown precision, and split by the location filter', async () => {
    const results = await runSources([
      loader('mixed', () => ({ events: [ev('1'), unlocated('2'), ev('3'), unlocated('4')], warnings: [] })),
    ], new MemoryStore(), { now: () => NOW });
    const all = buildEventsResponse(results, q(), NOW);
    expect(all.total).toBe(4);
    expect(all.summary.by_precision).toEqual({ exact: 2, unknown: 2 });
    const map = buildEventsResponse(results, q('location=map'), NOW);
    const nomap = buildEventsResponse(results, q('location=nomap'), NOW);
    expect(map.data.every(isMappable)).toBe(true);
    expect(map.total).toBe(2);
    expect(nomap.data.every(e => !isMappable(e))).toBe(true);
    expect(nomap.data.every(e => e.location.precision === 'unknown')).toBe(true);
  });

  it('a precision set by a normalizer beats the source default, but unlocated always wins', async () => {
    const area = ev('1', { location: { precision: 'area', lat: 1, lng: 2, country: 'US', region: '', label: 'County' } });
    const results = await runSources([loader('a', () => ({ events: [area, unlocated('2')], warnings: [] }), { precision: 'country' })], new MemoryStore(), { now: () => NOW });
    const byId = Object.fromEntries(results[0].events.map(e => [e.id, e.location.precision]));
    expect(byId).toEqual({ '1': 'area', '2': 'unknown' });
  });
});

describe('totals are computed before pagination', () => {
  const many = Array.from({ length: 250 }, (_, i) => ev(String(i + 1), { severity: i < 7 ? 'critical' : 'low', domain: i % 2 ? 'climate' : 'disaster' }));

  it('reports full totals and summary while returning only one page', async () => {
    const results = await runSources([loader('big', () => ({ events: many, warnings: [] }))], new MemoryStore(), { now: () => NOW });
    const body = buildEventsResponse(results, q('limit=100'), NOW);
    expect(body.count).toBe(100);
    expect(body.total).toBe(250);
    expect(body.total_unfiltered).toBe(250);
    expect(body.summary.total).toBe(250);
    expect(body.summary.by_domain).toEqual({ disaster: 125, climate: 125 });
    expect(body.summary.by_severity).toEqual({ critical: 7, low: 243 });
    expect(body.summary.top_events).toHaveLength(5);
    expect(body.next_offset).toBe(100);
  });

  it('the summary does not change with the page size or offset', async () => {
    const results = await runSources([loader('big', () => ({ events: many, warnings: [] }))], new MemoryStore(), { now: () => NOW });
    const a = buildEventsResponse(results, q('limit=1'), NOW).summary;
    const b = buildEventsResponse(results, q('limit=500&offset=100'), NOW).summary;
    expect(a).toEqual(b);
  });

  it('filters change the totals (not just the page)', async () => {
    const results = await runSources([loader('big', () => ({ events: many, warnings: [] }))], new MemoryStore(), { now: () => NOW });
    const body = buildEventsResponse(results, q('severity=critical&limit=3'), NOW);
    expect(body.total).toBe(7);
    expect(body.count).toBe(3);
    expect(body.total_unfiltered).toBe(250);
  });

  it('paging through every page returns each event exactly once', () => {
    const seen: string[] = [];
    let offset = 0;
    for (;;) {
      const { page, nextOffset } = paginate(many, { limit: 100, offset });
      seen.push(...page.map(e => e.id));
      if (nextOffset === null) break;
      offset = nextOffset;
    }
    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
  });

  it('applies the same filters to summaries as to the events', () => {
    const f = filterEvents(many, q('domain=climate'));
    expect(summarize(f).total).toBe(f.length);
    expect(f.every(e => e.domain === 'climate')).toBe(true);
  });
});

describe('response health', () => {
  it('is ok while a failing source is covered by retained data, and not ok when nothing can be served', async () => {
    const store = new MemoryStore();
    let fail = false;
    const l = loader('a', () => { if (fail) throw new Error('down'); return { events: [ev('1')], warnings: [] }; });
    const first = buildEventsResponse(await runSources([l], store, { now: () => NOW }), q(), NOW);
    expect(first.ok).toBe(true);
    fail = true;
    const retained = buildEventsResponse(await runSources([l], store, { now: () => NOW }), q(), NOW);
    expect(retained.ok).toBe(true);
    expect(retained.sources[0].retained).toBe(true);
    const dead = buildEventsResponse(await runSources([loader('b', () => { throw new Error('x'); })], new MemoryStore(), { now: () => NOW }), q(), NOW);
    expect(dead.ok).toBe(false);
  });
});
