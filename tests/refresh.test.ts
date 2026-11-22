import { describe, expect, it } from 'vitest';
import { applyOutcome } from '../src/data/refresh';
import type { SourceHealth } from '../src/health/sourceHealth';
import type { SourceFetch } from '../src/data/pipeline';
import type { SourceStatus } from '../shared/pipeline/engine';

const T0 = Date.UTC(2026, 10, 20, 12);
const prev: SourceHealth = { key: 'a', label: 'A', domain: 'disaster', status: 'loading', count: 0, warnings: [] };
const status = (over: Partial<SourceStatus> = {}): SourceStatus => ({
  key: 'a', label: 'A', domain: 'disaster', status: 'ok', count: 3, warnings: [], durationMs: 5, checkedAt: T0, refreshSeconds: 60,
  precision: 'exact', coverage: 'c', dataAt: T0, lastOkAt: T0, newestAt: new Date(T0).toISOString(), ...over,
});
const fetched = (s: SourceStatus, truncated: SourceFetch['truncated'] = null): SourceFetch => ({ events: [], status: s, truncated });

describe('applyOutcome (browser refresh behaviour)', () => {
  it('shows a healthy source as the server reported it', () => {
    const h = applyOutcome(prev, { ok: true, fetched: fetched(status()) }, { durationMs: 40, checkedAt: T0 });
    expect(h).toMatchObject({ status: 'ok', count: 3, retained: false, lastOkAt: T0, dataAt: T0, durationMs: 40 });
  });

  it('keeps the SERVER time for retained data: it is not stamped "now" (it used to be)', () => {
    const earlier = T0 - 45 * 60_000;
    const later = T0 + 10 * 60_000; // the browser checks again 10 minutes later
    const h = applyOutcome(prev, { ok: true, fetched: fetched(status({ status: 'error', retained: true, error: 'upstream down', dataAt: earlier, lastOkAt: earlier })) }, { durationMs: 9, checkedAt: later });
    expect(h.retained).toBe(true);
    expect(h.dataAt).toBe(earlier);
    expect(h.lastOkAt).toBe(earlier);
    expect(h.checkedAt).toBe(later); // "checked just now" and "fetched earlier" stay distinct
  });

  it('keeps what it knew when the pipeline itself cannot be reached, and flags the data as retained', () => {
    const known = applyOutcome(prev, { ok: true, fetched: fetched(status()) }, { durationMs: 1, checkedAt: T0 });
    const h = applyOutcome(known, { ok: false, error: 'pipeline 503', keptCount: 3 }, { durationMs: 1, checkedAt: T0 + 60_000 });
    expect(h).toMatchObject({ status: 'error', retained: true, count: 3, error: 'pipeline 503', lastOkAt: T0, dataAt: T0 });
    expect(h.newestAt).toBe(new Date(T0).toISOString());
  });

  it('is plain "down" (not retained) when nothing was ever loaded', () => {
    const h = applyOutcome(prev, { ok: false, error: 'pipeline 503', keptCount: 0 }, { durationMs: 1, checkedAt: T0 });
    expect(h).toMatchObject({ status: 'error', retained: false, count: 0 });
    expect(h.lastOkAt).toBeUndefined();
  });

  it('recovery clears the retained flag and the error', () => {
    const down = applyOutcome(prev, { ok: false, error: 'x', keptCount: 2 }, { durationMs: 1, checkedAt: T0 });
    const up = applyOutcome(down, { ok: true, fetched: fetched(status({ dataAt: T0 + 1, lastOkAt: T0 + 1 })) }, { durationMs: 1, checkedAt: T0 + 1 });
    expect(up.retained).toBe(false);
    expect(up.error).toBeUndefined();
    expect(up.status).toBe('ok');
  });

  it('reports truncation explicitly: a warning, and a healthy source becomes degraded', () => {
    const h = applyOutcome(prev, { ok: true, fetched: fetched(status(), { loaded: 20_000, total: 25_000 }) }, { durationMs: 1, checkedAt: T0 });
    expect(h.status).toBe('degraded');
    expect(h.warnings.join(' ')).toMatch(/20,000 of 25,000 events/);
  });

  it('does not downgrade a source that is already worse than degraded', () => {
    const h = applyOutcome(prev, { ok: true, fetched: fetched(status({ status: 'stale' }), { loaded: 10, total: 20 }) }, { durationMs: 1, checkedAt: T0 });
    expect(h.status).toBe('stale');
    expect(h.warnings).toHaveLength(1);
  });
});
