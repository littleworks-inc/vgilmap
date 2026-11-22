import { describe, expect, it } from 'vitest';
import { collapseIncidents, groupIncidents, hostOf, INCIDENT_WINDOW_MS, orgKey } from '../shared/pipeline/incidents';
import { matchesCyberFocus } from '../shared/types';
import type { EvidenceKind, VigilEvent } from '../shared/types';
import { ev } from './helpers';

const DAY = 24 * 3_600_000;
const T0 = Date.UTC(2026, 10, 10);
const when = (days: number) => new Date(T0 + days * DAY).toISOString();

/** A cyber report about `org`. */
function report(id: string, org: string, evidence: EvidenceKind, days: number, over: Partial<VigilEvent> & { meta?: Record<string, unknown>; country?: string } = {}): VigilEvent {
  const { meta, country = 'US', ...rest } = over;
  return ev(id, {
    domain: 'cyber', category: evidence === 'claim' ? 'ransomware' : 'cyberattack', severity: 'medium',
    timestamp: when(days), evidence, source: { claim: 'ransomware.live', report: 'BleepingComputer', confirmed: 'The Record', catalog: 'Have I Been Pwned', official: 'CISA KEV' }[evidence],
    location: { lat: 1, lng: 2, country, region: '', label: country, precision: 'country' },
    metadata: { [evidence === 'claim' ? 'victim' : 'impacted']: org, countryCode: country, ...meta },
    ...rest,
  });
}

describe('organization identity', () => {
  it('normalizes legal suffixes, punctuation, accents and case', () => {
    expect(orgKey('Asahi Group Holdings, Ltd.')).toBe('asahi');
    expect(orgKey('The Container Store, Inc.')).toBe('container store');
    expect(orgKey('Société Générale S.A.')).toBe('societe generale');
    expect(orgKey('AT&T')).toBe('at t');
    expect(orgKey('Acme L.L.C.')).toBe('acme');
  });
  it('extracts a hostname from a URL or bare domain, and nothing from junk', () => {
    expect(hostOf('https://www.Example.com/path?x=1')).toBe('example.com');
    expect(hostOf('ucageneral.com')).toBe('ucageneral.com');
    expect(hostOf('')).toBe('');
    expect(hostOf('not a domain')).toBe('');
  });
});

describe('groupIncidents', () => {
  it('turns a claim, a news confirmation and a breach-catalog entry about one company into ONE incident', () => {
    const events = [
      report('claim', 'Acme Corp', 'claim', 0, { meta: { group: 'qilin', domain: 'acme.com' } }),
      report('news', 'Acme', 'confirmed', 1, { title: 'Acme confirms ransomware attack' }),
      report('hibp', 'Acme Corporation', 'catalog', 3, { meta: { domain: 'www.acme.com' } }),
      report('other', 'Globex', 'claim', 1),
    ];
    const { incidents } = groupIncidents(events);
    expect(incidents).toHaveLength(2);
    const acme = incidents.find(i => i.reportCount === 3)!;
    expect(acme.reports.map(r => r.id)).toEqual(['claim', 'news', 'hibp']);           // timeline order
    expect(acme.evidence).toEqual(['confirmed', 'catalog', 'claim']);                  // strongest first
    expect(acme.sources).toEqual(['ransomware.live', 'The Record', 'Have I Been Pwned']);
    expect(acme.claimedBy).toBe('qilin');
    expect(acme.primaryId).toBe('news');                                               // the org's own statement represents it
    expect(acme.firstSeen).toBe(when(0));
    expect(acme.lastSeen).toBe(when(3));
  });

  it('keeps unrelated organizations apart', () => {
    const { incidents } = groupIncidents([report('a', 'Acme', 'claim', 0), report('b', 'Globex', 'claim', 0)]);
    expect(incidents).toHaveLength(2);
  });

  describe('conservative matching (a wrong merge hides a real incident)', () => {
    const merged = (a: VigilEvent, b: VigilEvent) => groupIncidents([a, b]).incidents.length === 1;

    it('merges on a shared website even when the names differ', () => {
      expect(merged(report('a', 'ABC', 'claim', 0, { meta: { domain: 'abcbank.com' } }), report('b', 'A. B. C. Bank', 'catalog', 1, { meta: { domain: 'abcbank.com' } }))).toBe(true);
    });
    it('merges a whole-word prefix of two or more words, or one long word', () => {
      expect(merged(report('a', 'Container Store', 'report', 0), report('b', 'Container Store Group', 'claim', 1))).toBe(true);
      expect(merged(report('a', 'Mondelez', 'report', 0), report('b', 'Mondelez International', 'claim', 1))).toBe(true);
    });
    it('does NOT merge a short single-word name into a longer one ("Bell" vs "Bell Canada")', () => {
      expect(merged(report('a', 'Bell', 'report', 0), report('b', 'Bell Canada', 'claim', 1))).toBe(false);
    });
    it('does NOT merge a partial word ("Acme" vs "Acmeville Hospital")', () => {
      expect(merged(report('a', 'Acme', 'report', 0), report('b', 'Acmeville Hospital', 'claim', 1))).toBe(false);
    });
    it('does NOT merge the same name placed in different countries', () => {
      expect(merged(report('a', 'Delta Services', 'claim', 0, { country: 'US' }), report('b', 'Delta Services', 'claim', 1, { country: 'DE' }))).toBe(false);
    });
    it('merges the same name when only one report has a country', () => {
      expect(merged(report('a', 'Delta Services', 'claim', 0, { country: 'US' }), report('b', 'Delta Services', 'report', 1, { country: '', location: { lat: 0, lng: 0, country: '', region: '', label: '', precision: 'unknown' } }))).toBe(true);
    });
    it('does NOT merge reports further apart than the window', () => {
      expect(merged(report('a', 'Acme', 'claim', 0), report('b', 'Acme', 'claim', 40))).toBe(false);
      expect(merged(report('a', 'Acme', 'claim', 0), report('b', 'Acme', 'claim', 20))).toBe(true);
    });
    it('the window limits the WHOLE incident, so a chain of reports cannot stretch it forever', () => {
      // A–B 15 days, B–C 15 days: each neighbouring pair is within 21 days, but A–C spans 30.
      const events = [report('a', 'Acme', 'claim', 0), report('b', 'Acme', 'report', 15), report('c', 'Acme', 'catalog', 30)];
      const { incidents } = groupIncidents(events);
      expect(incidents.map(i => i.reportCount).sort()).toEqual([1, 2]);
      for (const i of incidents) expect(Date.parse(i.lastSeen) - Date.parse(i.firstSeen)).toBeLessThanOrEqual(INCIDENT_WINDOW_MS);
      // ...and the same split however the input is ordered
      const split = (evs: VigilEvent[]) => groupIncidents(evs).incidents.map(i => i.reports.map(r => r.id).sort().join('+')).sort();
      expect(split([...events].reverse())).toEqual(split(events));
    });
    it('invariant: no incident ever spans more than the window, for any pattern of reports', () => {
      let seed = 7;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const events = Array.from({ length: 120 }, (_, i) => report(`r${i}`, 'Acme', (['claim', 'report', 'catalog', 'confirmed'] as const)[i % 4], Math.floor(rnd() * 120)));
      for (const inc of groupIncidents(events).incidents) {
        expect(Date.parse(inc.lastSeen) - Date.parse(inc.firstSeen)).toBeLessThanOrEqual(INCIDENT_WINDOW_MS);
      }
    });
  });

  describe('country compatibility holds for the whole group, not just each pair', () => {
    const noCountry = { lat: 0, lng: 0, country: '', region: '', label: '', precision: 'unknown' as const };
    const ids = (evs: VigilEvent[]) => groupIncidents(evs).incidents.map(i => i.reports.map(r => r.id).sort());

    it('US and German "Delta Services" do not join through a third report that names no country', () => {
      const events = [
        report('us', 'Delta Services', 'claim', 0, { country: 'US' }),
        report('de', 'Delta Services', 'claim', 1, { country: 'DE' }),
        report('x', 'Delta Services', 'report', 1, { location: noCountry, metadata: { impacted: 'Delta Services', unlocated: true } }),
      ];
      const groups = ids(events);
      expect(groups.some(g => g.includes('us') && g.includes('de'))).toBe(false);
      expect(groups).toHaveLength(2);
    });
    it('is the same split in EVERY input order when equal-strength, equal-time candidates tie', () => {
      const permutations = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p])));
      const partition = (evs: VigilEvent[]) => groupIncidents(evs).incidents.map(i => `${i.id}:${i.reports.map(r => r.id).sort().join('+')}`).sort().join(' | ');
      // Same organization, same instant: unplaced (a), US (b), Germany (c). Whichever incident the unplaced
      // report joins must not depend on which of them happens to be listed first.
      const at = (id: string, country: string | null) => report(id, 'Delta Services', 'claim', 0, country
        ? { country }
        : { location: noCountry, metadata: { victim: 'Delta Services', unlocated: true } });
      const three = [at('a', null), at('b', 'US'), at('c', 'DE')];
      const expected = partition(three);
      for (const p of permutations(three)) expect(partition(p)).toBe(expected);
      // ...and with more unplaced reports in the mix
      const five = [at('a', null), at('b', 'US'), at('c', 'DE'), at('d', null), at('e', 'US')];
      const expected5 = partition(five);
      for (const p of permutations(five)) expect(partition(p)).toBe(expected5);
    });
    it('is the same split in any input order', () => {
      const events = [
        report('us', 'Delta Services', 'claim', 0, { country: 'US' }),
        report('de', 'Delta Services', 'claim', 1, { country: 'DE' }),
        report('x', 'Delta Services', 'report', 1, { location: noCountry, metadata: { impacted: 'Delta Services', unlocated: true } }),
      ];
      const norm = (g: string[][]) => g.map(x => x.join('+')).sort();
      expect(norm(ids([...events].reverse()))).toEqual(norm(ids(events)));
      expect(norm(ids([events[2], events[0], events[1]]))).toEqual(norm(ids(events)));
    });
    it('a matching WEBSITE does not bypass the country check', () => {
      const a = report('a', 'Acme US', 'claim', 0, { country: 'US', meta: { domain: 'acme.com' } });
      const b = report('b', 'Acme Germany', 'catalog', 1, { country: 'DE', meta: { domain: 'acme.com' } });
      expect(groupIncidents([a, b]).incidents).toHaveLength(2);
    });
    it('a matching website still merges reports from one country, or with one unplaced', () => {
      const a = report('a', 'Acme', 'claim', 0, { country: 'US', meta: { domain: 'acme.com' } });
      const b = report('b', 'A. C. M. E.', 'catalog', 1, { country: 'US', meta: { domain: 'acme.com' } });
      expect(groupIncidents([a, b]).incidents).toHaveLength(1);
    });
  });

  describe('occurrence date, not publication date', () => {
    it('does NOT merge a 2020 breach added to the catalog now with a current attack on the same company', () => {
      const oldBreach = report('hibp', 'Acme', 'catalog', 0, { meta: { breachDate: '2020-03-01', domain: 'acme.com' } }); // added now, happened in 2020
      const claim = report('claim', 'Acme', 'claim', 1, { meta: { domain: 'acme.com' } });
      expect(groupIncidents([oldBreach, claim]).incidents).toHaveLength(2);
    });
    it('DOES merge a breach that happened around the same time as the claim, even if it was added much later', () => {
      const recent = report('hibp', 'Acme', 'catalog', -60, { meta: { breachDate: new Date(T0 + 1 * DAY).toISOString().slice(0, 10), domain: 'acme.com' } }); // published 60 days later
      const claim = report('claim', 'Acme', 'claim', 0, { meta: { domain: 'acme.com' } });
      const { incidents } = groupIncidents([recent, claim]);
      expect(incidents).toHaveLength(1);
      expect(incidents[0].reports.find(r => r.id === 'hibp')?.occurredAt).toMatch(/^2026-11-11/); // kept apart from the publication time
    });
    it('falls back to the publication time when a report gives no occurrence date', () => {
      const a = report('a', 'Acme', 'claim', 0);
      const b = report('b', 'Acme', 'report', 5);
      expect(groupIncidents([a, b]).incidents).toHaveLength(1);
      expect(groupIncidents([a, b]).incidents[0].reports.every(r => r.occurredAt === undefined)).toBe(true);
    });
  });
  it('never groups CISA KEV entries: a vulnerability is not an attack on an organization', () => {
    const kev = (id: string) => report(id, 'Acme', 'official', 0, { category: 'vulnerability', title: id });
    const { incidents, ungrouped } = groupIncidents([kev('CVE-1'), kev('CVE-2')]);
    expect(incidents).toEqual([]);
    expect(ungrouped.map(e => e.id)).toEqual(['CVE-1', 'CVE-2']);
  });

  it('leaves non-cyber events and reports naming no organization ungrouped', () => {
    const quake = ev('q1');
    const nameless = ev('n1', { domain: 'cyber', evidence: 'report', metadata: {} });
    const junk = report('j1', 'A Ransomware Attack on a Company Ranked Among the Top', 'claim', 0);
    expect(groupIncidents([quake, nameless, junk]).ungrouped.map(e => e.id).sort()).toEqual(['j1', 'n1', 'q1']);
  });

  it('is deterministic: same input in any order gives the same incident ids and primary', () => {
    const events = [report('a', 'Acme', 'claim', 0), report('b', 'Acme', 'report', 1), report('c', 'Acme', 'catalog', 2)];
    const one = groupIncidents(events).incidents[0];
    const two = groupIncidents([...events].reverse()).incidents[0];
    expect(two.id).toBe(one.id);
    expect(two.primaryId).toBe(one.primaryId);
    expect(two.reports.map(r => r.id)).toEqual(one.reports.map(r => r.id));
  });

  it('has the same id and name whatever the input order, even when the reports spell the organization differently', () => {
    const events = [report('a', 'Mondelez International', 'claim', 0), report('b', 'Mondelez', 'claim', 1), report('c', 'Mondelez Global LLC', 'catalog', 2)];
    const forward = groupIncidents(events).incidents;
    expect(forward).toHaveLength(1);
    for (const order of [[2, 1, 0], [1, 0, 2], [0, 2, 1]]) {
      const [inc] = groupIncidents(order.map(i => events[i])).incidents;
      expect(inc.id).toBe(forward[0].id);
      expect(inc.org).toBe(forward[0].org);
      expect(inc.primaryId).toBe(forward[0].primaryId);
    }
    expect(forward[0].org).toBe('Mondelez');   // the canonical name is a fixed rule, not "whichever came first"
  });

  it('takes the incident\'s severity and most specific category from its reports', () => {
    const { incidents } = groupIncidents([
      report('a', 'Acme', 'claim', 0, { severity: 'critical' }),
      report('b', 'Acme', 'report', 1, { severity: 'medium', category: 'data-breach' }),
    ]);
    expect(incidents[0]).toMatchObject({ severity: 'critical', category: 'ransomware' });
  });
});

describe('where an incident sits on the map', () => {
  const noPlace = { lat: 0, lng: 0, country: '', region: '', label: 'Location not stated', precision: 'unknown' as const };
  const claim = () => report('claim', 'Container Store', 'claim', 0, { country: 'US' });
  const article = () => report('news', 'Container Store', 'report', 1, { location: noPlace, metadata: { impacted: 'Container Store', unlocated: true } });

  it('an incident whose strongest report has no location takes the location of a report that does', () => {
    const { events } = collapseIncidents([claim(), article()]);
    expect(events).toHaveLength(1);
    const shown = events[0];
    expect(shown.id).toBe('news');                               // the news report still represents it...
    expect(shown.location.country).toBe('US');                    // ...but it is placed where the claim says
    expect(shown.metadata?.unlocated).toBeUndefined();            // so it stays on the map
    expect(groupIncidents([claim(), article()]).incidents[0].placeId).toBe('claim');
  });
  it('prefers the more precise location, and leaves a located representative alone', () => {
    const exact = report('x', 'Acme', 'catalog', 0, { location: { lat: 5, lng: 6, country: 'US', region: '', label: 'HQ', precision: 'exact' } });
    const country = report('y', 'Acme', 'confirmed', 1);
    const { events } = collapseIncidents([exact, country]);
    expect(events[0].id).toBe('y');
    expect(events[0].location.country).toBe('US');
    expect(events[0].location.precision).toBe('country');         // primary is already located: not replaced
    expect(groupIncidents([exact, country]).incidents[0].placeId).toBe('x');
  });
  it('an incident with no located report stays list-only', () => {
    const a = report('a', 'Acme', 'report', 0, { location: noPlace, metadata: { impacted: 'Acme', unlocated: true } });
    const b = report('b', 'Acme', 'confirmed', 1, { location: noPlace, metadata: { impacted: 'Acme', unlocated: true } });
    const { events } = collapseIncidents([a, b]);
    expect(events[0].metadata?.unlocated).toBe(true);
  });
});

describe('collapsed incidents stay visible to Cyber Trends filters', () => {
  // A Qilin leak-site claim for a US retailer, plus a breach-catalog entry that has no group, sector or country code.
  const claim = report('claim', 'Acme Stores', 'claim', 0, { severity: 'high', meta: { group: 'Qilin', sector: 'Retail', countryCode: 'US', domain: 'acme.com' } });
  const catalog = report('hibp', 'Acme Stores', 'catalog', 1, { category: 'data-breach', meta: { domain: 'acme.com', countryCode: undefined, group: undefined, sector: undefined } });
  const shown = collapseIncidents([claim, catalog]).events[0];

  it('the representative may be the article/catalog entry, but it carries the claim\'s ransomware category', () => {
    expect(shown.id).toBe('hibp');                       // catalog outranks the claim as the representative
    expect(shown.category).toBe('ransomware');           // the incident's category, not the catalog entry's
  });
  it('still matches the group, sector and country of the claim it absorbed (it used to disappear from the Qilin filter)', () => {
    expect(matchesCyberFocus(shown, { dimension: 'groups', key: 'qilin', label: 'Qilin' })).toBe(true);
    expect(matchesCyberFocus(shown, { dimension: 'sectors', key: 'Retail', label: 'Retail' })).toBe(true);
    expect(matchesCyberFocus(shown, { dimension: 'countries', key: 'US', label: 'US' })).toBe(true);
  });
  it('does not match groups, sectors or countries none of its reports mention', () => {
    expect(matchesCyberFocus(shown, { dimension: 'groups', key: 'lockbit', label: 'LockBit' })).toBe(false);
    expect(matchesCyberFocus(shown, { dimension: 'sectors', key: 'Healthcare', label: 'Healthcare' })).toBe(false);
    expect(matchesCyberFocus(shown, { dimension: 'countries', key: 'DE', label: 'DE' })).toBe(false);
  });
  it('exposes the aggregates for the API as well', () => {
    const [inc] = groupIncidents([claim, catalog]).incidents;
    expect(inc).toMatchObject({ groups: ['Qilin'], sectors: ['Retail'], countryCodes: ['US'] });
  });
  it('an incident without a ransomware report never matches a ransomware focus', () => {
    const a = report('a', 'Beta', 'report', 0, { category: 'data-breach' });
    const b = report('b', 'Beta', 'catalog', 1, { category: 'data-breach' });
    const only = collapseIncidents([a, b]).events[0];
    expect(matchesCyberFocus(only, { dimension: 'groups', key: 'qilin', label: 'Qilin' })).toBe(false);
  });
});

describe('collapseIncidents', () => {
  const events = [
    report('claim', 'Acme', 'claim', 0, { severity: 'high', meta: { group: 'qilin' } }),
    report('solo', 'Globex', 'claim', 1),
    report('news', 'Acme', 'report', 2),
    ev('quake'),
  ];

  it('shows each multi-report incident once, as its strongest report, and leaves everything else alone', () => {
    const { events: shown, memberToPrimary } = collapseIncidents(events);
    expect(shown.map(e => e.id).sort()).toEqual(['news', 'quake', 'solo']);
    const primary = shown.find(e => e.id === 'news')!;
    expect(primary.incidentId).toMatch(/^incident-/);
    expect(primary.severity).toBe('high');                                   // raised to the incident's highest
    expect((primary.metadata?.incident as { reportCount: number }).reportCount).toBe(2);
    expect(memberToPrimary.get('claim')).toBe('news');
    expect(memberToPrimary.get('news')).toBe('news');
    expect(shown.find(e => e.id === 'solo')?.incidentId).toBeUndefined();     // a single report is not collapsed
  });

  it('preserves the original order of the events that remain', () => {
    const { events: shown } = collapseIncidents(events);
    expect(shown.map(e => e.id)).toEqual(['solo', 'news', 'quake']);
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(events);
    collapseIncidents(events);
    expect(JSON.stringify(events)).toBe(before);
  });
});
