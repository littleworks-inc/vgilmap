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
    expect(store.get('a')?.events).toHaveLength(2);
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
      store.set('a', { events: [ev('1')], at: NOW - 60_000 });
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
