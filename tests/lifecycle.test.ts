import { describe, expect, it } from 'vitest';
import { MemoryStore, runSource } from '../shared/pipeline/engine';
import { buildEventsResponse, filterEvents, parseQuery, QueryError } from '../shared/pipeline/query';
import { isExpired } from '../shared/types';
import { ev, loader, NOW } from './helpers';

const known = { sources: ['a'] };
const q = (s = '') => parseQuery(new URLSearchParams(s), known);
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();
const alertEv = (id: string, endsInMin: number | null) => ev(id, { domain: 'climate', ...(endsInMin === null ? {} : { expiresAt: iso(endsInMin) }) });

describe('isExpired', () => {
  it('is false with no expiry, before it, and true at and after it', () => {
    expect(isExpired({}, NOW)).toBe(false);
    expect(isExpired({ expiresAt: iso(10) }, NOW)).toBe(false);
    expect(isExpired({ expiresAt: iso(0) }, NOW)).toBe(true);
    expect(isExpired({ expiresAt: iso(-10) }, NOW)).toBe(true);
  });
  it('never expires an event on an unparseable date', () => {
    expect(isExpired({ expiresAt: 'soon' }, NOW)).toBe(false);
  });
});

describe('lifecycle filtering', () => {
  const events = [alertEv('live', 60), alertEv('ended', -60), alertEv('open-ended', null)];

  it('hides expired events by default', () => {
    expect(filterEvents(events, q(), NOW).map(e => e.id)).toEqual(['live', 'open-ended']);
  });
  it('lifecycle=expired shows only the ended ones, lifecycle=all shows both', () => {
    expect(filterEvents(events, q('lifecycle=expired'), NOW).map(e => e.id)).toEqual(['ended']);
    expect(filterEvents(events, q('lifecycle=all'), NOW)).toHaveLength(3);
  });
  it('rejects an unknown lifecycle with the valid values', () => {
    try { q('lifecycle=resolved'); expect.unreachable(); } catch (e) {
      expect(e).toBeInstanceOf(QueryError);
      expect((e as QueryError).valid).toEqual(['active', 'expired', 'all']);
    }
  });
});

describe('response: lifecycle is stamped at read time', () => {
  const run = async (events: ReturnType<typeof alertEv>[]) => {
    const l = loader('a', () => ({ events, warnings: [] }));
    return [await runSource(l, new MemoryStore(), { now: () => NOW })];
  };

  it('stamps every served event, counts what is hidden, and reports the next expiry', async () => {
    const results = await run([alertEv('live1', 30), alertEv('live2', 90), alertEv('ended', -5), alertEv('open', null)]);
    const body = buildEventsResponse(results, q(), NOW);
    expect(body.total).toBe(3);
    expect(body.total_expired).toBe(1);
    expect(body.next_expiry).toBe(iso(30));
    expect(body.data.every(e => e.lifecycle === 'active')).toBe(true);
    const all = buildEventsResponse(results, q('lifecycle=all'), NOW);
    expect(all.data.find(e => e.id === 'ended')?.lifecycle).toBe('expired');
  });

  it('the SAME retained data stops being served as current once its alerts end', async () => {
    // An alert feed goes down; its last good copy is retained and served...
    const store = new MemoryStore();
    let up = true;
    const l = loader('a', () => { if (!up) throw new Error('NWS down'); return { events: [alertEv('flood', 30), alertEv('wind', 120)], warnings: [] }; });
    await runSource(l, store, { now: () => NOW });
    up = false;
    const retained = await runSource(l, store, { now: () => NOW + 10 * 60_000 });
    expect(retained.status.retained).toBe(true);

    // ...at +10 min both are still active; at +45 min the flood warning has ended, at +3h both have.
    const at = (min: number) => buildEventsResponse([retained], q(), NOW + min * 60_000);
    expect(at(10).data.map(e => e.id).sort()).toEqual(['flood', 'wind']);
    expect(at(45).data.map(e => e.id)).toEqual(['wind']);
    expect(at(180).data).toEqual([]);
    expect(at(180).total_expired).toBe(2);
  });

  it('no next expiry when nothing active has an end time', async () => {
    const body = buildEventsResponse(await run([alertEv('open', null)]), q(), NOW);
    expect(body.next_expiry).toBeNull();
  });
});
