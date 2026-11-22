import { describe, expect, it } from 'vitest';
import { MemoryStore, runSources } from '../shared/pipeline/engine';
import { buildEventsResponse, filterEvents, mergeEvents, paginate, parseQuery, QueryError, summarize } from '../shared/pipeline/query';
import { isMappable } from '../shared/types';
import { ev, loader, NOW } from './helpers';

const known = { sources: ['mixed', 'big', 'a', 'b'] };
const q = (s = '') => parseQuery(new URLSearchParams(s), known);
const unlocated = (id: string) => ev(id, { domain: 'cyber', location: { lat: 0, lng: 0, country: 'Global', region: '', label: 'Global' }, metadata: { unlocated: true } });

describe('parseQuery', () => {
  it('has sensible defaults and clamps out-of-range limits', () => {
    expect(q()).toMatchObject({ limit: 100, location: 'all' });
    expect(q('limit=99999').limit).toBe(1000);
    expect(q('limit=0').limit).toBe(1);
  });

  describe('rejects unsupported filters instead of silently widening the result', () => {
    const msg = (qs: string) => { try { q(qs); return null; } catch (e) { return e as QueryError; } };
    it('unknown source, listing the valid ones', () => {
      const e = msg('source=typo');
      expect(e).toBeInstanceOf(QueryError);
      expect(e?.message).toMatch(/Unknown source "typo"/);
      expect(e?.valid).toEqual(known.sources);
    });
    it('unknown domain, even next to a valid one', () => {
      expect(msg('domain=cyber,nonsense')?.message).toMatch(/Unknown domain "nonsense"/);
      expect(msg('domain=cyber,nonsense')?.valid).toContain('cyber');
    });
    it('unknown severity and location', () => {
      expect(msg('severity=urgent')?.valid).toContain('critical');
      expect(msg('location=elsewhere')?.valid).toEqual(['all', 'map', 'nomap']);
    });
    it('malformed dates, limits and cursors', () => {
      expect(msg('since=garbage')?.message).toMatch(/Invalid "since"/);
      expect(msg('limit=abc')?.message).toMatch(/Invalid "limit"/);
      expect(msg('limit=-3')?.message).toMatch(/Invalid "limit"/);
      expect(msg('cursor=%%%')?.message).toMatch(/Invalid "cursor"/);
    });
    it('the removed offset parameter, pointing at cursor', () => {
      expect(msg('offset=100')?.message).toMatch(/cursor/);
    });
  });

  it('accepts every valid filter', () => {
    const parsed = q('domain=cyber,health&source=a,b&severity=high&since=2026-11-01T00:00:00Z&location=map&limit=5');
    expect(parsed).toMatchObject({ domains: ['cyber', 'health'], sources: ['a', 'b'], minSeverity: 'high', location: 'map', limit: 5 });
    expect(parsed.since).toBe(Date.UTC(2026, 10, 1));
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
  it('orders events with the same timestamp by id, so the order is always the same', () => {
    const t = '2026-11-20T00:00:00.000Z';
    const merged = mergeEvents([{ events: [ev('b', { timestamp: t }), ev('a', { timestamp: t }), ev('c', { timestamp: t })] }]);
    expect(merged.map(e => e.id)).toEqual(['a', 'b', 'c']);
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
  const run = (events = many) => runSources([loader('big', () => ({ events, warnings: [] }))], new MemoryStore(), { now: () => NOW });

  it('reports full totals and summary while returning only one page', async () => {
    const body = buildEventsResponse(await run(), q('limit=100'), NOW);
    expect(body.count).toBe(100);
    expect(body.total).toBe(250);
    expect(body.total_unfiltered).toBe(250);
    expect(body.summary.total).toBe(250);
    expect(body.summary.by_domain).toEqual({ disaster: 125, climate: 125 });
    expect(body.summary.by_severity).toEqual({ critical: 7, low: 243 });
    expect(body.summary.top_events).toHaveLength(5);
    expect(body.next_cursor).toEqual(expect.any(String));
  });

  it('the summary does not change with the page size or position', async () => {
    const results = await run();
    const first = buildEventsResponse(results, q('limit=1'), NOW);
    const later = buildEventsResponse(results, q(`limit=500&cursor=${first.next_cursor}`), NOW);
    expect(first.summary).toEqual(later.summary);
  });

  it('filters change the totals (not just the page)', async () => {
    const body = buildEventsResponse(await run(), q('severity=critical&limit=3'), NOW);
    expect(body.total).toBe(7);
    expect(body.count).toBe(3);
    expect(body.total_unfiltered).toBe(250);
  });

  it('applies the same filters to summaries as to the events', () => {
    const f = filterEvents(many, q('domain=climate'));
    expect(summarize(f).total).toBe(f.length);
    expect(f.every(e => e.domain === 'climate')).toBe(true);
  });
});

describe('cursor pagination', () => {
  const at = (i: number) => new Date(NOW - i * 60_000).toISOString();
  const dataset = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ev(`e${String(from + i).padStart(4, '0')}`, { timestamp: at(from + i) }));
  const all = (events: ReturnType<typeof dataset>) => mergeEvents([{ events }]);

  function walk(read: () => ReturnType<typeof all>, limit: number, between?: (page: number) => void) {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; ; page++) {
      const { page: items, nextCursor }: { page: ReturnType<typeof all>; nextCursor: string | null } = paginate(read(), parseQuery(new URLSearchParams(`limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`), known));
      seen.push(...items.map(e => e.id));
      if (nextCursor === null) break;
      cursor = nextCursor;
      between?.(page);
    }
    return seen;
  }

  it('returns every event exactly once on a static dataset', () => {
    const events = all(dataset(250));
    const seen = walk(() => events, 100);
    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
  });

  it('does not repeat or skip events when NEW events arrive between pages (offsets did)', () => {
    let events = all(dataset(250, 10));
    const seen = walk(() => events, 100, () => { events = all([...dataset(10, 0), ...events]); }); // 10 newer events land after every page
    const original = dataset(250, 10).map(e => e.id);
    expect(new Set(seen).size).toBe(seen.length);          // no repeats
    expect(original.every(id => seen.includes(id))).toBe(true); // nothing skipped
  });

  it('does not skip events when older ones expire between pages', () => {
    let events = all(dataset(250));
    const seen = walk(() => events, 100, () => { events = events.filter(e => e.id !== 'e0249'); });
    expect(seen).toHaveLength(249);
  });

  it('ends cleanly: no cursor on the last page, and a cursor past the end yields an empty page', () => {
    const events = all(dataset(3));
    expect(paginate(events, { limit: 3 }).nextCursor).toBeNull();
    const { nextCursor } = paginate(events, { limit: 2 });
    const after = paginate(events, { limit: 2, cursor: parseQuery(new URLSearchParams(`cursor=${nextCursor}`), known).cursor });
    expect(after.page.map(e => e.id)).toEqual(['e0002']);
    const end = paginate(events, { limit: 2, cursor: { ts: 0, id: '' } });
    expect(end.page).toEqual([]);
    expect(end.nextCursor).toBeNull();
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
