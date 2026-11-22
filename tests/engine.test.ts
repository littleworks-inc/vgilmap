import { describe, expect, it } from 'vitest';
import { MemoryStore, runSource, runSources } from '../shared/pipeline/engine';
import { ev, loader, NOW } from './helpers';

const clock = (start = NOW) => { let t = start; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

describe('runSource', () => {
  it('reports a healthy source and stores its events', async () => {
    const store = new MemoryStore();
    const r = await runSource(loader('a', () => ({ events: [ev('1'), ev('2')], warnings: [] })), store, { now: () => NOW });
    expect(r.status).toMatchObject({ key: 'a', status: 'ok', count: 2, precision: 'exact' });
    expect(r.status.retained).toBeUndefined();
    expect(r.events).toHaveLength(2);
    expect(store.get('a')?.good?.events).toHaveLength(2);
  });

  it('marks a source with partial-failure warnings as degraded, and still returns its events', async () => {
    const r = await runSource(loader('a', () => ({ events: [ev('1')], warnings: ['BBC feed unavailable'] })), new MemoryStore(), { now: () => NOW });
    expect(r.status.status).toBe('degraded');
    expect(r.status.warnings).toEqual(['BBC feed unavailable']);
    expect(r.events).toHaveLength(1);
  });

  it('reports "empty" when a source answers with nothing', async () => {
    const r = await runSource(loader('a', () => ({ events: [], warnings: [] })), new MemoryStore(), { now: () => NOW });
    expect(r.status.status).toBe('empty');
  });

  it('flags a source whose newest event is older than its freshness budget as stale', async () => {
    const old = ev('1', { timestamp: new Date(NOW - 10 * 3_600_000).toISOString() });
    const r = await runSource(loader('a', () => ({ events: [old], warnings: [] }), { staleAfterHours: 3 }), new MemoryStore(), { now: () => NOW });
    expect(r.status.status).toBe('stale');
  });

  it('reports an error with no data when it fails and nothing was ever fetched', async () => {
    const r = await runSource(loader('a', () => { throw new Error('upstream 503'); }), new MemoryStore(), { now: () => NOW });
    expect(r.status).toMatchObject({ status: 'error', count: 0, error: 'upstream 503' });
    expect(r.status.retained).toBeUndefined();
    expect(r.events).toEqual([]);
  });

  describe('retained stale data', () => {
    it('keeps serving the last good events, flagged retained, when a refresh fails', async () => {
      const store = new MemoryStore();
      const c = clock();
      let fail = false;
      const l = loader('a', () => { if (fail) throw new Error('boom'); return { events: [ev('1'), ev('2'), ev('3')], warnings: [] }; });

      const first = await runSource(l, store, { now: c.now });
      expect(first.status.status).toBe('ok');

      fail = true; c.advance(5 * 60_000);
      const second = await runSource(l, store, { now: c.now });
      expect(second.events.map(e => e.id)).toEqual(['1', '2', '3']);
      expect(second.status).toMatchObject({ status: 'error', retained: true, count: 3, error: 'boom', dataAt: NOW, lastOkAt: NOW });
    });

    it('recovers cleanly: a later success clears the retained flag and replaces the data', async () => {
      const store = new MemoryStore();
      let mode: 'ok' | 'fail' | 'ok2' = 'ok';
      const l = loader('a', () => {
        if (mode === 'fail') throw new Error('boom');
        return { events: mode === 'ok' ? [ev('1')] : [ev('9'), ev('8')], warnings: [] };
      });
      await runSource(l, store, { now: () => NOW });
      mode = 'fail'; await runSource(l, store, { now: () => NOW });
      mode = 'ok2';
      const r = await runSource(l, store, { now: () => NOW });
      expect(r.status.retained).toBeUndefined();
      expect(r.status.status).toBe('ok');
      expect(r.events.map(e => e.id)).toEqual(['9', '8']);
    });

    it('treats a loader that never answers as failed (and retains)', async () => {
      const store = new MemoryStore();
      store.set('a', { good: { events: [ev('1')], at: NOW - 60_000 } });
      const l = loader('a', () => new Promise(() => { /* never settles */ }));
      const r = await runSource(l, store, { now: () => NOW, timeoutMs: 20 });
      expect(r.status).toMatchObject({ status: 'error', retained: true, count: 1 });
      expect(r.status.error).toMatch(/timed out/);
    });
  });
});

describe('runSources: partial source failures', () => {
  it('one failing source never affects the others', async () => {
    const store = new MemoryStore();
    const results = await runSources([
      loader('good', () => ({ events: [ev('1')], warnings: [] })),
      loader('bad', () => { throw new Error('down'); }),
      loader('warn', () => ({ events: [ev('2')], warnings: ['one feed missing'] })),
    ], store, { now: () => NOW });
    expect(results.map(r => [r.status.key, r.status.status])).toEqual([['good', 'ok'], ['bad', 'error'], ['warn', 'degraded']]);
    expect(results[0].events).toHaveLength(1);
    expect(results[2].events).toHaveLength(1);
  });
});

describe('partial failures of multi-feed sources (retained per feed)', () => {
  const claims = [ev('c1', { source: 'ransomware.live' })];
  const kev = [ev('k1', { source: 'CISA KEV' })];

  it('a feed that fails keeps ITS previous events instead of shrinking the dataset', async () => {
    const store = new MemoryStore();
    let kevUp = true;
    const l = loader('cyber', () => ({
      events: kevUp ? [...claims, ...kev] : [...claims],
      warnings: kevUp ? [] : ['CISA KEV unavailable'],
      parts: [
        { name: 'ransomware.live', ok: true, events: claims },
        { name: 'CISA KEV', ok: kevUp, events: kevUp ? kev : [] },
      ],
    }));
    const first = await runSource(l, store, { now: () => NOW });
    expect(first.events.map(e => e.id).sort()).toEqual(['c1', 'k1']);

    kevUp = false;
    const degraded = await runSource(l, store, { now: () => NOW });
    expect(degraded.events.map(e => e.id).sort()).toEqual(['c1', 'k1']); // was shrinking to ['c1']
    expect(degraded.status.status).toBe('degraded');
    expect(degraded.status.warnings.join(' ')).toMatch(/CISA KEV unavailable/);
    expect(degraded.status.warnings.join(' ')).toMatch(/CISA KEV: refresh failed, showing 1 events from just now/);
  });

  it('a feed that answers replaces its old events (they are not retained forever)', async () => {
    const store = new MemoryStore();
    let second = false;
    const l = loader('cyber', () => ({
      events: second ? [ev('c2', { source: 'ransomware.live' })] : claims, warnings: [],
      parts: [{ name: 'ransomware.live', ok: true, events: second ? [ev('c2', { source: 'ransomware.live' })] : claims }],
    }));
    await runSource(l, store, { now: () => NOW });
    second = true;
    const r = await runSource(l, store, { now: () => NOW });
    expect(r.events.map(e => e.id)).toEqual(['c2']);
  });

  it('keeps the earlier events of a failed feed across several consecutive failures', async () => {
    const store = new MemoryStore();
    let up = true;
    const l = loader('cyber', () => ({
      events: up ? kev : [], warnings: up ? [] : ['down'],
      parts: [{ name: 'CISA KEV', ok: up, events: up ? kev : [] }],
    }));
    await runSource(l, store, { now: () => NOW });
    up = false;
    await runSource(l, store, { now: () => NOW });
    const third = await runSource(l, store, { now: () => NOW });
    expect(third.events.map(e => e.id)).toEqual(['k1']);
  });
});

describe('source snapshots (reuseFresh)', () => {
  it('serves a fresh snapshot without calling upstream again, and refetches once it is older than the refresh interval', async () => {
    const store = new MemoryStore();
    const c = clock();
    let calls = 0;
    const l = loader('a', () => { calls++; return { events: [ev('1')], warnings: [] }; }, { refreshSeconds: 3600 });
    await runSource(l, store, { now: c.now, reuseFresh: true });
    c.advance(59 * 60_000);
    await runSource(l, store, { now: c.now, reuseFresh: true });
    expect(calls).toBe(1);
    c.advance(2 * 60_000);
    await runSource(l, store, { now: c.now, reuseFresh: true });
    expect(calls).toBe(2);
  });

  it('concurrent requests share one upstream fetch', async () => {
    const store = new MemoryStore();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const l = loader('a', async () => { calls++; await gate; return { events: [ev('1')], warnings: [] }; });
    const runs = [1, 2, 3].map(() => runSource(l, store, { now: () => NOW, reuseFresh: true }));
    release();
    const results = await Promise.all(runs);
    expect(calls).toBe(1);
    expect(results.every(r => r.events.length === 1)).toBe(true);
  });

  it('backs off for a short while after a failure instead of hammering a struggling upstream', async () => {
    const store = new MemoryStore();
    const c = clock();
    let calls = 0;
    const l = loader('a', () => { calls++; throw new Error('down'); }, { refreshSeconds: 3600 });
    await runSource(l, store, { now: c.now, reuseFresh: true });
    c.advance(10_000);
    await runSource(l, store, { now: c.now, reuseFresh: true });
    expect(calls).toBe(1);
    c.advance(25_000); // past the 30s back-off
    await runSource(l, store, { now: c.now, reuseFresh: true });
    expect(calls).toBe(2);
  });

  it('keeps reporting the ORIGINAL data time for retained data served from a snapshot', async () => {
    const store = new MemoryStore();
    const c = clock();
    let fail = false;
    const l = loader('a', () => { if (fail) throw new Error('boom'); return { events: [ev('1')], warnings: [] }; }, { refreshSeconds: 60 });
    await runSource(l, store, { now: c.now, reuseFresh: true });
    fail = true; c.advance(10 * 60_000);
    const r = await runSource(l, store, { now: c.now, reuseFresh: true });
    expect(r.status).toMatchObject({ retained: true, dataAt: NOW, lastOkAt: NOW });
    expect(r.status.checkedAt).toBe(NOW + 10 * 60_000);
  });
});

describe('timestamps and flags when only some feeds are retained', () => {
  const T = (min: number) => NOW + min * 60_000;
  const feedA = [ev('a1', { source: 'A' })];
  const feedB = [ev('b1', { source: 'B' })];
  /** A source with two feeds whose state the test controls. */
  function twoFeeds(state: { a: 'up' | 'down'; b: 'up' | 'down' | 'empty' }) {
    return loader('two', () => {
      const a = { name: 'A', ok: state.a === 'up', events: state.a === 'up' ? feedA : [] };
      const b = { name: 'B', ok: state.b !== 'down', events: state.b === 'up' ? feedB : [] };
      return { events: [...a.events, ...b.events], warnings: [a, b].filter(p => !p.ok).map(p => `${p.name} unavailable`), parts: [a, b] };
    }, { refreshSeconds: 3600 });
  }

  it('retained events keep their ORIGINAL fetch time even when the other feed answers with zero events', async () => {
    const store = new MemoryStore();
    const state = { a: 'up' as 'up' | 'down', b: 'up' as 'up' | 'down' | 'empty' };
    const l = twoFeeds(state);
    await runSource(l, store, { now: () => T(0) });

    state.a = 'down'; state.b = 'empty'; // A fails; B succeeds with nothing. Every returned event is retained.
    const r = await runSource(l, store, { now: () => T(45) });
    expect(r.events.map(e => e.id)).toEqual(['a1']); // every returned event is retained
    expect(r.status.retained).toBe(true);
    expect(r.status.dataAt).toBe(T(0));       // was stamped "now" (T(45))
    expect(r.status.lastOkAt).toBe(T(0));     // nothing came back fresh, so "last had data" does not move
    expect(r.status.checkedAt).toBe(T(45));
    expect(r.status.status).toBe('degraded');
    expect(r.status.parts).toEqual([
      { name: 'A', ok: false, retained: true, count: 1, dataAt: T(0) },
      { name: 'B', ok: true, count: 0, dataAt: T(45) },
    ]);
    expect(r.status.warnings.join(' ')).toMatch(/A: refresh failed, showing 1 events from 45m ago/);
  });

  it('with a fresh feed alongside a retained one: data time is the oldest feed, last-ok is now', async () => {
    const store = new MemoryStore();
    const state = { a: 'up' as 'up' | 'down', b: 'up' as 'up' | 'down' | 'empty' };
    const l = twoFeeds(state);
    await runSource(l, store, { now: () => T(0) });
    state.a = 'down';
    const r = await runSource(l, store, { now: () => T(30) });
    expect(r.events.map(e => e.id).sort()).toEqual(['a1', 'b1']);
    expect(r.status).toMatchObject({ retained: true, dataAt: T(0), lastOkAt: T(30) });
    expect(r.status.parts?.map(p => [p.name, p.ok, p.retained ?? false, p.dataAt])).toEqual([['A', false, true, T(0)], ['B', true, false, T(30)]]);
  });

  it('is not flagged retained when every feed answered', async () => {
    const r = await runSource(twoFeeds({ a: 'up', b: 'up' }), new MemoryStore(), { now: () => T(0) });
    expect(r.status.retained).toBeUndefined();
    expect(r.status.dataAt).toBe(T(0));
  });

  it('the retained time survives a later TOTAL failure too', async () => {
    const store = new MemoryStore();
    const state = { a: 'up' as 'up' | 'down', b: 'up' as 'up' | 'down' | 'empty' };
    const l = twoFeeds(state);
    await runSource(l, store, { now: () => T(0) });
    state.a = 'down';
    await runSource(l, store, { now: () => T(30) });       // partial: A retained from T(0), B fresh at T(30)
    const broken = loader('two', () => { throw new Error('everything down'); }, { refreshSeconds: 3600 });
    const r = await runSource(broken, store, { now: () => T(100) });
    expect(r.status).toMatchObject({ status: 'error', retained: true, dataAt: T(0), lastOkAt: T(30) });
  });
});

describe('partial failures are retried on the failure back-off, not held for the full interval', () => {
  function flaky(calls: { n: number }) {
    return loader('two', () => {
      calls.n++;
      return { events: [ev('b1')], warnings: ['A unavailable'], parts: [{ name: 'A', ok: false, events: [] }, { name: 'B', ok: true, events: [ev('b1')] }] };
    }, { refreshSeconds: 3600 });
  }

  it('does not hammer upstream inside the back-off, but retries after 30s even though the source interval is an hour', async () => {
    const store = new MemoryStore();
    const c = clock();
    const calls = { n: 0 };
    const l = flaky(calls);
    await runSource(l, store, { now: c.now, reuseFresh: true });
    c.advance(10_000);
    await runSource(l, store, { now: c.now, reuseFresh: true });
    expect(calls.n).toBe(1);
    c.advance(21_000); // 31s after the partial result
    await runSource(l, store, { now: c.now, reuseFresh: true });
    expect(calls.n).toBe(2); // was still 1: the degraded result was reused for the whole hour
  });

  it('a normalizer warning alone (no parts) also counts as partial', async () => {
    const store = new MemoryStore();
    const c = clock();
    let calls = 0;
    const l = loader('g', () => { calls++; return { events: [ev('1')], warnings: ['showing cached data'] }; }, { refreshSeconds: 3600 });
    await runSource(l, store, { now: c.now, reuseFresh: true });
    c.advance(31_000);
    await runSource(l, store, { now: c.now, reuseFresh: true });
    expect(calls).toBe(2);
  });

  it('a fully healthy result is still held for the whole interval', async () => {
    const store = new MemoryStore();
    const c = clock();
    let calls = 0;
    const l = loader('ok', () => { calls++; return { events: [ev('1')], warnings: [] }; }, { refreshSeconds: 3600 });
    await runSource(l, store, { now: c.now, reuseFresh: true });
    c.advance(31_000);
    await runSource(l, store, { now: c.now, reuseFresh: true });
    expect(calls).toBe(1);
  });
});
