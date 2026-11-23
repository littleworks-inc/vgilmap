import { describe, expect, it } from 'vitest';
import { buildBriefing, evidenceSummary, incidentFacts, incidentHeadline, understanding } from '../src/today/briefing';
import { loadSeen, MAX_ITEMS, saveSeen, SEEN_KEY } from '../src/today/seen';
import type { SeenSnapshot } from '../src/today/seen';
import { groupIncidents } from '../shared/pipeline/incidents';
import type { EvidenceKind, VigilEvent } from '../shared/types';
import { ev } from './helpers';

const NOW = Date.UTC(2026, 10, 22, 12);
const HOUR = 3_600_000;
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR).toISOString();

function cyber(id: string, org: string, evidence: EvidenceKind, hoursAgo: number, over: Partial<VigilEvent> & { meta?: Record<string, unknown> } = {}): VigilEvent {
  const { meta, ...rest } = over;
  return ev(id, {
    domain: 'cyber', category: evidence === 'claim' ? 'ransomware' : 'data-breach', severity: 'high', timestamp: at(hoursAgo), evidence,
    title: `${evidence} about ${org}`, source: { claim: 'ransomware.live', report: 'The Record', confirmed: 'Acme newsroom', catalog: 'Have I Been Pwned', official: 'CISA' }[evidence],
    location: { lat: 1, lng: 2, country: 'US', region: '', label: 'United States', precision: 'country' },
    metadata: { [evidence === 'claim' ? 'victim' : 'impacted']: org, countryCode: 'US', ...(evidence === 'claim' ? { group: 'qilin' } : {}), ...meta }, ...rest,
  });
}
const quake = (id: string, sev: VigilEvent['severity'], hoursAgo: number) => ev(id, { domain: 'disaster', category: 'earthquake', severity: sev, timestamp: at(hoursAgo), title: `Earthquake ${id}`, location: { lat: 1, lng: 2, country: 'JP', region: '', label: 'Near Tokyo', precision: 'exact' } });

describe('evidence summary and headline say no more than the evidence does', () => {
  it('lists the strongest evidence first, with correct plurals', () => {
    expect(evidenceSummary([{ evidence: 'report' }, { evidence: 'claim' }, { evidence: 'report' }, { evidence: 'confirmed' }])).toBe('1 organization statement · 2 news reports · 1 attacker claim');
    expect(evidenceSummary([{ evidence: 'catalog' }])).toBe('1 breach-catalog entry');
    expect(evidenceSummary([])).toBe('');
  });
  it('a claim-only incident is "claimed", never "confirmed"', () => {
    const [i] = groupIncidents([cyber('c', 'Acme', 'claim', 3)]).incidents;
    expect(incidentHeadline(i)).toBe('Acme: ransomware attack claimed by qilin');
  });
  it('stance follows the strongest evidence', () => {
    const head = (evs: VigilEvent[]) => incidentHeadline(groupIncidents(evs).incidents[0]);
    expect(head([cyber('c', 'Acme', 'claim', 3), cyber('n', 'Acme', 'report', 2)])).toMatch(/reported$/);
    expect(head([cyber('c', 'Acme', 'claim', 3), cyber('n', 'Acme', 'confirmed', 2)])).toMatch(/confirmed by the organization$/);
    expect(head([cyber('h', 'Acme', 'catalog', 2)])).toMatch(/listed in a breach catalog$/);
  });
});

describe('buildBriefing', () => {
  const events = [
    cyber('c1', 'Acme', 'claim', 5), cyber('n1', 'Acme', 'report', 4),
    quake('q1', 'high', 2), quake('q2', 'high', 3), quake('q3', 'high', 4), quake('q4', 'high', 5), quake('q5', 'high', 6), quake('low', 'low', 1),
    ev('kev', { domain: 'cyber', category: 'vulnerability', severity: 'critical', timestamp: at(1), evidence: 'official', title: 'CVE-1' }),
  ];

  it('a first visit gets a global briefing, with no "since your last visit" claims', () => {
    const b = buildBriefing({ events, seen: null, now: NOW });
    expect(b.sinceLast).toEqual([]);
    expect(b.lastVisitAt).toBeUndefined();
    expect(b.major.length).toBeGreaterThan(0);
    expect(b.major.every(c => c.change.kind === 'first-visit' && /^First reported/.test(c.change.text))).toBe(true);
  });

  it('shows a mix of domains, not nine earthquakes', () => {
    const b = buildBriefing({ events, seen: null, now: NOW });
    expect(b.major.filter(c => c.domain === 'disaster')).toHaveLength(3);
    expect(b.major.some(c => c.domain === 'cyber')).toBe(true);
  });

  it('leaves out low-severity items and exploited vulnerabilities (a vulnerability is not an incident at a place)', () => {
    const b = buildBriefing({ events, seen: null, now: NOW });
    const ids = [...b.major, ...b.sinceLast].map(c => c.id);
    expect(ids).not.toContain('low');
    expect(ids).not.toContain('kev');
  });

  it('groups the claim and the news report into ONE incident card', () => {
    const cards = buildBriefing({ events, seen: null, now: NOW }).major.filter(c => c.kind === 'incident');
    expect(cards).toHaveLength(1);
    expect(cards[0].evidenceSummary).toBe('1 news report · 1 attacker claim');
  });

  describe('against what this browser saw last time', () => {
    const first = buildBriefing({ events, seen: null, now: NOW });
    const seen: SeenSnapshot = { at: NOW - 24 * HOUR, items: first.snapshot };

    it('reports nothing as new when nothing changed, and says so per card', () => {
      const b = buildBriefing({ events, seen, now: NOW });
      expect(b.sinceLast).toEqual([]);
      expect(b.major.every(c => c.change.kind === 'unchanged')).toBe(true);
      expect(b.lastVisitAt).toBe(NOW - 24 * HOUR);
    });
    it('flags a new incident as new', () => {
      const b = buildBriefing({ events: [...events, quake('new', 'critical', 1)], seen, now: NOW });
      expect(b.sinceLast.map(c => [c.id, c.change.kind])).toEqual([['new', 'new']]);
    });
    it('flags an incident that gained a report, and names the evidence that was added', () => {
      const b = buildBriefing({ events: [...events, cyber('conf', 'Acme', 'confirmed', 1)], seen, now: NOW });
      const card = b.sinceLast.find(c => c.kind === 'incident')!;
      expect(card.change).toEqual({ kind: 'more-reports', text: '+1 report since your last visit: organization statement added' });
    });
    it('a new low-severity item does not crowd the briefing, but an added report to a seen item always shows', () => {
      const lowNew = buildBriefing({ events: [...events, quake('tiny', 'low', 1)], seen, now: NOW });
      expect(lowNew.sinceLast).toEqual([]);
      const lowUpdate = buildBriefing({
        events: [cyber('l1', 'Tiny Co', 'claim', 5, { severity: 'low' }), cyber('l2', 'Tiny Co', 'report', 3, { severity: 'low' })],
        seen: { at: NOW - 10 * HOUR, items: buildBriefing({ events: [cyber('l1', 'Tiny Co', 'claim', 5, { severity: 'low' })], seen: null, now: NOW }).snapshot }, now: NOW,
      });
      expect(lowUpdate.sinceLast).toHaveLength(1);
    });
  });

  it('puts an alert\'s end time on its card, and never shows an expired one', () => {
    const live = ev('wx', { domain: 'climate', severity: 'high', timestamp: at(1), title: 'Flood Warning', expiresAt: new Date(NOW + 2 * HOUR).toISOString() });
    const gone = ev('old', { domain: 'climate', severity: 'critical', timestamp: at(3), title: 'Old Warning', expiresAt: new Date(NOW - HOUR).toISOString() });
    const b = buildBriefing({ events: [live, gone], seen: null, now: NOW });
    expect(b.major.map(c => c.id)).toEqual(['wx']);
    expect(b.major[0].note).toMatch(/^Active until/);
  });

  it('an incident resting only on an attacker claim ranks below a measured event of the same severity', () => {
    const claimOnly = cyber('c', 'Acme', 'claim', 1, { severity: 'critical' });
    const measured = quake('m', 'high', 1);
    const order = buildBriefing({ events: [claimOnly, measured], seen: null, now: NOW }).major.map(c => c.id);
    expect(order[0]).toBe('m');
    // ...but a claim that others corroborate is not penalised
    const backed = buildBriefing({ events: [claimOnly, cyber('n', 'Acme', 'report', 1, { severity: 'critical' }), measured], seen: null, now: NOW }).major;
    expect(backed[0].kind).toBe('incident');
  });

  it('ranks by severity then recency, deterministically', () => {
    const a = buildBriefing({ events, seen: null, now: NOW }).major.map(c => c.id);
    const b = buildBriefing({ events: [...events].reverse(), seen: null, now: NOW }).major.map(c => c.id);
    expect(b).toEqual(a);
  });
});

describe('identical alerts for several areas are one card', () => {
  const alert = (id: string, over: Partial<VigilEvent> = {}) => ev(id, {
    domain: 'climate', category: 'weather', severity: 'high', source: 'NOAA NWS', timestamp: at(1), title: 'Heavy Freezing Spray Warning by NWS Fairbanks AK',
    expiresAt: new Date(NOW + 5 * HOUR).toISOString(), ...over,
  });
  const copies = [alert('z1'), alert('z2'), alert('z3')];

  it('shows one card for the same warning issued per zone, and says how many areas', () => {
    const b = buildBriefing({ events: copies, seen: null, now: NOW });
    const cards = [...b.sinceLast, ...b.major];
    expect(cards).toHaveLength(1);
    expect(cards[0].note).toMatch(/Also issued for 2 other areas/);
    expect(cards[0].memberIds.sort()).toEqual(['z1', 'z2', 'z3']);
  });
  it('does not merge different warnings, or the same title from a different source', () => {
    const b = buildBriefing({ events: [alert('a'), alert('b', { title: 'Coastal Flood Warning by NWS Seattle WA' }), alert('c', { source: 'Other' })], now: NOW, seen: null });
    expect([...b.sinceLast, ...b.major]).toHaveLength(3);
  });
  it('a merged card is not "new" again on the next visit, whichever copy represents it', () => {
    const first = buildBriefing({ events: copies, seen: null, now: NOW });
    const seen: SeenSnapshot = { at: NOW, items: first.snapshot };
    const again = buildBriefing({ events: [...copies].reverse(), seen, now: NOW + HOUR });
    expect(again.sinceLast).toHaveLength(0);
  });
  it('a copy added later is part of the same card, not a new one', () => {
    const first = buildBriefing({ events: copies.slice(0, 2), seen: null, now: NOW });
    const again = buildBriefing({ events: copies, seen: { at: NOW, items: first.snapshot }, now: NOW + HOUR });
    expect(again.sinceLast).toHaveLength(0);
    expect(again.major[0].note).toMatch(/2 other areas/);
  });
});

describe('incidentFacts: each fact carries its own evidence, and unknowns stay unknown', () => {
  const build = (evs: VigilEvent[]) => {
    const [i] = groupIncidents(evs).incidents;
    return { i, facts: incidentFacts(i, new Map(evs.map(e => [e.id, e]))) };
  };
  const fact = (facts: ReturnType<typeof incidentFacts>, id: string) => facts.find(f => f.id === id)!;

  it('an organization confirmation and an unverified theft claim sit side by side with different support', () => {
    const { facts } = build([cyber('claim', 'Acme', 'claim', 5), cyber('stmt', 'Acme', 'confirmed', 2, { title: 'Acme confirms it was hit by ransomware' })]);
    expect(fact(facts, 'happened')).toMatchObject({ established: true, answer: 'The organization itself has said so.' });
    expect(fact(facts, 'happened').support.map(s => s.evidence)).toEqual(['confirmed']);
    expect(fact(facts, 'data').answer).toMatch(/claims to hold the organization's data\. Not verified/);
    expect(fact(facts, 'data').support.map(s => s.evidence)).toEqual(['claim']);
  });

  it('claim-only: the incident is "claimed, unverified", and theft/services/scale are not established', () => {
    const { facts } = build([cyber('claim', 'Acme', 'claim', 5)]);
    expect(fact(facts, 'happened').answer).toMatch(/Claimed by qilin .* Unverified/);
    expect(fact(facts, 'services')).toMatchObject({ established: false, answer: 'Not established.' });
    expect(fact(facts, 'scale')).toMatchObject({ established: false });
    expect(fact(facts, 'scale').answer).toMatch(/No supporting figure available/);
  });

  it('takes a record count only from a source that gives one, and says what it counts', () => {
    const { facts } = build([cyber('hibp', 'Acme', 'catalog', 4, { meta: { pwnCount: 3_400_000, dataClasses: ['Emails', 'Passwords'] } })]);
    expect(fact(facts, 'data').answer).toBe('The breach catalog lists 3.4 million accounts exposed (Emails, Passwords).');
    expect(fact(facts, 'scale').answer).toMatch(/3,400,000 accounts, per the breach catalog.*may not be the same as affected people/);
    expect(fact(facts, 'scale').support[0].source).toBe('Have I Been Pwned');
  });

  it('only reports service disruption when a report actually says so', () => {
    const quiet = build([cyber('n', 'Acme', 'report', 2, { title: 'Acme hit by cyberattack' })]).facts;
    expect(fact(quiet, 'services').established).toBe(false);
    const loud = build([cyber('n', 'Acme', 'report', 2, { title: 'Acme restores systems after cyberattack outage' })]).facts;
    expect(fact(loud, 'services').established).toBe(true);
    expect(fact(loud, 'services').answer).toMatch(/No status notice from the organization/);
  });

  it('keeps the occurrence date apart from the publication date', () => {
    const { facts } = build([cyber('hibp', 'Acme', 'catalog', 1, { meta: { breachDate: '2026-11-15' } })]);
    expect(fact(facts, 'when').answer).toMatch(/per Have I Been Pwned\. First reported/);
  });

  it('every established fact has at least one supporting report, every unknown has none', () => {
    const { facts } = build([cyber('claim', 'Acme', 'claim', 5), cyber('n', 'Acme', 'report', 2)]);
    for (const f of facts) expect(f.established ? f.support.length > 0 : f.support.length === 0).toBe(true);
  });

  it('the one-line understanding never overstates', () => {
    const line = (evs: VigilEvent[]) => understanding(groupIncidents(evs).incidents[0]);
    expect(line([cyber('c', 'Acme', 'claim', 3)])).toMatch(/^Only the attackers say this happened \(qilin\), and it is unverified\./);
    expect(line([cyber('c', 'Acme', 'claim', 3), cyber('n', 'Acme', 'report', 2)])).toMatch(/^News outlets report this; the organization has not confirmed it\. An attacker group \(qilin\) also claims it\./);
    expect(line([cyber('c', 'Acme', 'claim', 3), cyber('s', 'Acme', 'confirmed', 2)])).toMatch(/^The organization has confirmed this\./);
  });
});

describe('a real-sized window does not make everything look new (this was a bug: a 400-item cap)', () => {
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  const many = (n: number) => Array.from({ length: n }, (_, i) => ev(`e${i}`, { domain: i % 2 ? 'climate' : 'disaster', severity: i % 3 ? 'medium' : 'high', timestamp: at(1 + (i % 100)), title: `Event ${i}`, location: { lat: 1, lng: 2, country: 'US', region: '', label: 'Somewhere', precision: 'exact' } }));

  it('a second visit to an unchanged window reports nothing new, with far more items than the old cap', () => {
    const events = many(1500);
    const store = memory();
    const first = buildBriefing({ events, seen: null, now: NOW });
    saveSeen(first.snapshot, NOW - HOUR, store);
    const second = buildBriefing({ events, seen: loadSeen(store), now: NOW });
    expect(second.sinceLast).toEqual([]);
    expect(Object.keys(loadSeen(store)!.items)).toHaveLength(1500);
    expect(loadSeen(store)!.partial).toBeUndefined();
  });

  it('only a genuinely new item shows up as new', () => {
    const events = many(1500);
    const store = memory();
    saveSeen(buildBriefing({ events, seen: null, now: NOW }).snapshot, NOW - HOUR, store);
    const b = buildBriefing({ events: [...events, ev('fresh', { domain: 'disaster', severity: 'critical', timestamp: at(0.2), title: 'Fresh' })], seen: loadSeen(store), now: NOW });
    expect(b.sinceLast.map(c => c.id)).toEqual(['fresh']);
  });

  it('when the snapshot is cut, it keeps the most important items and does not call the rest new', () => {
    const events = many(MAX_ITEMS + 300);
    const store = memory();
    saveSeen(buildBriefing({ events, seen: null, now: NOW }).snapshot, NOW - HOUR, store);
    const seen = loadSeen(store)!;
    expect(seen.partial).toBe(true);
    expect(Object.keys(seen.items)).toHaveLength(MAX_ITEMS);
    const second = buildBriefing({ events, seen, now: NOW });
    expect(second.sinceLast).toEqual([]);                                           // the cut-off items are not "new"
    const fresh = buildBriefing({ events: [...events, ev('fresh', { domain: 'disaster', severity: 'critical', timestamp: at(0.2), title: 'Fresh' })], seen, now: NOW });
    expect(fresh.sinceLast.map(c => c.id)).toEqual(['fresh']);                       // ...but a real new one still is
  });
});

describe('seen snapshot storage', () => {
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m }; };

  it('round-trips what was on screen', () => {
    const s = memory();
    saveSeen({ a: { n: 2, evidence: ['claim', 'report'] } }, 123, s);
    expect(loadSeen(s)).toEqual({ at: 123, items: { a: { n: 2, evidence: ['claim', 'report'] } } });
  });
  it('stores a filtered view as partial, so what it left out is not "new" when shown later', () => {
    const s = memory();
    saveSeen({ a: { n: 1, evidence: [] } }, 123, s, true);
    expect(loadSeen(s)).toEqual({ at: 123, items: { a: { n: 1, evidence: [] } }, partial: true });

    // A weather alert published BEFORE the saved visit, absent only because the domain was hidden, is not new...
    const old = ev('w1', { domain: 'climate', category: 'weather', severity: 'high', source: 'NOAA NWS', timestamp: at(30), title: 'Old warning' });
    const fresh = ev('w2', { domain: 'climate', category: 'weather', severity: 'high', source: 'NOAA NWS', timestamp: at(0.5), title: 'Fresh warning' });
    const seen = loadSeen(s)!;
    const b = buildBriefing({ events: [old, fresh], seen: { ...seen, at: NOW - HOUR }, now: NOW });
    expect(b.sinceLast.map(c => c.id)).toEqual(['w2']); // ...but one published after it still is
  });
  it('treats missing, corrupt or wrongly-shaped data as "no previous visit"', () => {
    const s = memory();
    expect(loadSeen(s)).toBeNull();
    s.raw.set(SEEN_KEY, '{not json');
    expect(loadSeen(s)).toBeNull();
    s.raw.set(SEEN_KEY, JSON.stringify({ at: 'yesterday', items: {} }));
    expect(loadSeen(s)).toBeNull();
    s.raw.set(SEEN_KEY, JSON.stringify({ at: 1, items: { ok: { n: 1, evidence: [] }, bad: { n: 'x' } } }));
    expect(loadSeen(s)?.items).toEqual({ ok: { n: 1, evidence: [] } });
  });
  it('never throws when storage is unavailable or full', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
    expect(loadSeen(broken)).toBeNull();
    expect(() => saveSeen({}, 1, broken)).not.toThrow();
    expect(loadSeen(null)).toBeNull();
    expect(() => saveSeen({}, 1, null)).not.toThrow();
  });
});
