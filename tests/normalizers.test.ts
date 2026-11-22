import { describe, expect, it } from 'vitest';
import { normalizeNOAA } from '../shared/adapters/noaa';
import { normalizeReliefWeb } from '../shared/adapters/reliefweb';
import { normalizeCyberNews } from '../shared/adapters/cyber-news';
import { normalizeCyber } from '../shared/adapters/cyber';
import { normalizeScience } from '../shared/adapters/science';
import { normalizeFirms } from '../shared/adapters/nasa-firms';
import { isMappable } from '../shared/types';

const alert = (id: string, geometry: unknown) => ({
  type: 'Feature', id, geometry,
  properties: {
    id, areaDesc: 'Some County', status: 'Actual', messageType: 'Alert', severity: 'Severe', certainty: 'Likely', urgency: 'Expected',
    event: 'Flood Warning', headline: 'Flood Warning issued', description: 'Rising water.', instruction: null, sent: '2026-11-20T10:00:00Z',
    effective: '2026-11-20T10:00:00Z', expires: '2026-11-21T10:00:00Z', ends: null, onset: null, category: 'Met', response: 'Avoid', affectedZones: [], parameters: {},
  },
});

describe('NOAA', () => {
  it('places alerts that have a polygon and keeps alerts without geometry as list-only events', () => {
    const poly = { type: 'Polygon', coordinates: [[[-90, 30], [-88, 30], [-88, 32], [-90, 32], [-90, 30]]] };
    const events = normalizeNOAA({ type: 'FeatureCollection', features: [alert('a', poly), alert('b', null)] } as never);
    expect(events).toHaveLength(2);
    const [placed, unplaced] = events;
    expect(isMappable(placed)).toBe(true);
    expect(placed.location).toMatchObject({ lat: 31, lng: -89 });
    expect(isMappable(unplaced)).toBe(false);
    expect(unplaced.title).toContain('Flood Warning');
  });
  it('skips exercises and tests', () => {
    const f = alert('x', null);
    f.properties.status = 'Exercise';
    expect(normalizeNOAA({ type: 'FeatureCollection', features: [f] } as never)).toHaveLength(0);
  });
});

describe('NOAA alert lifetime', () => {
  const withTimes = (ends: string | null, expires: string | null) => {
    const f = alert('t', null);
    f.properties.ends = ends as never; f.properties.expires = expires as never;
    return normalizeNOAA({ type: 'FeatureCollection', features: [f] } as never)[0];
  };
  it('expires when the alert ENDS, and falls back to its expiry time', () => {
    expect(withTimes('2026-11-20T18:00:00Z', '2026-11-21T10:00:00Z').expiresAt).toBe('2026-11-20T18:00:00.000Z');
    expect(withTimes(null, '2026-11-21T10:00:00Z').expiresAt).toBe('2026-11-21T10:00:00.000Z');
  });
  it('has no expiry when the feed gives no usable time (it is never silently expired)', () => {
    expect(withTimes(null, null).expiresAt).toBeUndefined();
    expect(withTimes('garbage', 'also garbage').expiresAt).toBeUndefined();
  });
});

describe('ReliefWeb (no DOM)', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>ReliefWeb - Disasters</title>
  <item><title>Haiti: Floods - Oct 2026</title><link>https://reliefweb.int/disaster/fl-2026-000201-hti</link>
  <pubDate>Sat, 24 Oct 2026 00:00:00 +0000</pubDate>
  <description>
    &lt;div class="tag country"&gt;Affected country: Haiti&lt;/div&gt;
    &lt;div class="tag glide"&gt;Glide: FL-2026-000201-HTI&lt;/div&gt;
    &lt;p&gt;Since 24 October 2026, heavy rains have affected the South department.&lt;/p&gt;
  </description></item>
  <item><title>Somewhere: Epidemic</title><link>https://reliefweb.int/disaster/ep-2026-000001</link>
  <pubDate>Sat, 24 Oct 2026 00:00:00 +0000</pubDate>
  <description>&lt;div class="tag glide"&gt;Glide: EP-2026-000001-XXX&lt;/div&gt;&lt;p&gt;An outbreak.&lt;/p&gt;</description></item>
  </channel></rss>`;

  it('reads the country, the GLIDE code (which decides the type) and the text', () => {
    const [haiti] = normalizeReliefWeb(xml);
    expect(haiti).toMatchObject({ id: 'reliefweb-FL-2026-000201-HTI', domain: 'disaster', category: 'flood', source: 'ReliefWeb' });
    expect(haiti.location.country).toBe('HT');
    expect(haiti.description).toContain('heavy rains');
  });
  it('classifies by GLIDE prefix, and marks an item with no recognisable country as unlocated', () => {
    const outbreak = normalizeReliefWeb(xml)[1];
    expect(outbreak).toMatchObject({ domain: 'health', category: 'outbreak' });
    expect(isMappable(outbreak)).toBe(false);
  });
  it('throws on something that is not a feed', () => {
    expect(() => normalizeReliefWeb('<html>Service unavailable</html>')).toThrow(/could not be parsed/);
  });
});

describe('Cyber news', () => {
  const item = (title: string) => ({ title, link: `https://ex.com/${encodeURIComponent(title)}`, date: '2026-11-20T08:00:00Z', description: '', feed: 'Test Feed' });
  const run = (titles: string[], feeds?: Array<{ name: string; ok: boolean }>) => normalizeCyberNews({ items: titles.map(item), feeds });

  it('never places an incident in the attacker\'s country', () => {
    const [e] = run(['China-Linked Hackers Exploit VMware Zero-Day in Attacks'] ).events;
    expect(e.category).toBe('espionage'); // state-linked outranks the exploited-vulnerability rule
    expect(isMappable(e)).toBe(false); // no victim country named: list-only, not China
  });
  it('places an incident at the victim country', () => {
    const [e] = run(['Ransomware attack hits Japanese brewer Asahi in Japan']).events;
    expect(e.category).toBe('ransomware');
    expect(e.location.country).toBe('JP');
  });
  it('drops patch notes, weekly roundups and non-incidents', () => {
    expect(run(['Microsoft fixes critical flaw in Windows', 'In Other News: Cisco patches, Google bug bounty', 'New laptop reviewed']).events).toHaveLength(0);
  });
  it('reports a feed that failed as a warning while still returning the rest', () => {
    const r = run(['Ransomware gang leaks data from hospital'], [{ name: 'The Record', ok: false }, { name: 'Krebs', ok: true }]);
    expect(r.events).toHaveLength(1);
    expect(r.warnings).toEqual(['The Record feed unavailable']);
  });
});

describe('Evidence labels: a statement verb alone proves neither victim nor confirmation', () => {
  const item = (title: string) => ({ title, link: `https://ex.com/${encodeURIComponent(title)}`, date: '2026-11-20T08:00:00Z', description: '', feed: 'Test Feed' });
  const read = (title: string) => normalizeCyberNews({ items: [item(title)] }).events[0];
  const notVictimOrConfirmed = (title: string) => {
    const e = read(title);
    expect(e.evidence, title).toBe('report');
    expect(e.metadata?.impacted, title).toBeUndefined();
  };

  describe('generic incident vocabulary does not establish ownership (it may belong to someone else)', () => {
    it.each([
      'Microsoft says ransomware attacks hit hospitals worldwide',
      'Microsoft says ransomware attacks disrupt hospital operations',
      'CISA confirms ransomware attackers stole hospital patient records',
      'Microsoft says ransomware attack disrupted hospital systems',
      'FBI confirms ransomware attack shut down school networks and exposed student records',
    ])('%s', notVictimOrConfirmed);
  });

  describe('negation and denial, whatever the punctuation', () => {
    it.each([
      'Acme confirms third-party breach did not affect its systems',
      'Acme says ransomware attack did not affect its systems',
      "Acme says ransomware attack didn't affect its systems",
      'Acme says ransomware attack didn\u2019t affect its systems',   // curly apostrophe
      'Acme says ransomware attack wasn\u2019t successful against its network',
      'Acme denies it was hit by ransomware attack',
    ])('%s', notVictimOrConfirmed);
  });

  describe('hedged or investigating language is not a confirmation', () => {
    it.each([
      'Acme says it is investigating claims of a data breach',
      'Acme says it is looking into a possible ransomware attack on its systems',
      'Acme says it is aware of reports of a cyberattack on its network',
    ])('%s', title => {
      const e = read(title);
      expect(e.evidence).toBe('report');   // the organization is named, but nothing is confirmed
    });
  });

  it('third-party framing names the affected organization but is not its own confirmation', () => {
    const e = read('Acme confirms vendor breach exposed its customer records');
    expect(e.evidence).toBe('report');
  });

  describe('a real self-reference is a confirmation', () => {
    it.each([
      ['Asahi confirms it was hit by a ransomware attack', 'Asahi'],
      ['Bell Canada says hackers stole its customer data in a breach', 'Bell Canada'],
      ['Dollar General discloses it was hit by ransomware attack', 'Dollar General'],
      ['Acme notifies customers of data breach', 'Acme'],
      ['Acme warns customers after hackers breached its network', 'Acme'],
      ['Acme says its systems were encrypted in a ransomware attack', 'Acme'],
    ])('%s', (title, org) => {
      const e = read(title);
      expect(e.evidence).toBe('confirmed');
      expect(e.metadata?.impacted).toBe(org);
    });
  });

  it('a formal statement with no self-reference is treated as news: this trades recall for precision', () => {
    // A genuine statement, but nothing in the headline refers back to the speaker.
    notVictimOrConfirmed('Asahi confirms ransomware attack disrupted operations');
  });

  it('an incident verb makes the organization the victim, but is a report, not its own statement', () => {
    const e = read('Container Store restores systems after cyberattack');
    expect(e.metadata?.impacted).toBe('Container Store');
    expect(e.evidence).toBe('report');
  });
});

describe('Evidence labels (who says it happened)', () => {
  const item = (title: string) => ({ title, link: `https://ex.com/${encodeURIComponent(title)}`, date: '2026-11-20T08:00:00Z', description: '', feed: 'Test Feed' });
  const evidenceOf = (title: string) => normalizeCyberNews({ items: [item(title)] }).events[0]?.evidence;

  it('news where the organization affirms its own incident is org-confirmed', () => {
    expect(evidenceOf('Asahi confirms it was hit by a ransomware attack that disrupted operations')).toBe('confirmed');
    expect(evidenceOf('Bell Canada notifies customers of data breach')).toBe('confirmed');
  });
  it('news that is only reporting is a news report', () => {
    expect(evidenceOf('Hackers breach hospital network, steal patient data')).toBe('report');
    expect(evidenceOf('Ransomware gang leaks data from Midwest school district')).toBe('report');
  });
  it('an advisory "warns of" something is not a victim speaking; a victim "warns customers" is', () => {
    const impacted = (title: string) => normalizeCyberNews({ items: [item(title)] }).events[0]?.metadata?.impacted;
    expect(impacted('CISA Warns of 4 Exploited Flaws Linked to Ransomware Attacks')).toBeUndefined();
    expect(impacted('GnuPG Warns Critical Flaw Could Expose App Data via Malicious Input')).toBeUndefined();
    expect(impacted('Bell Canada warns customers of data breach after hackers stole records')).toBe('Bell Canada');
  });
  it('a third party saying something is not the organization confirming it', () => {
    // "Amazon says Chinese hackers ..." is Amazon reporting on someone else: no victim guess, so just a report.
    expect(evidenceOf('Amazon says Chinese hackers exploited a zero-day in attacks')).toBe('report');
  });
  it('ransomware leak-site listings are attacker claims; CISA KEV is an official advisory', () => {
    const r = normalizeCyber({
      victims: [{ victim: 'Acme', group: 'qilin', country: 'US', attackdate: '2026-11-20T00:00:00Z' }],
      kev: [{ cveID: 'CVE-2026-1', vendorProject: 'Acme', product: 'Router', dateAdded: '2026-11-19' }],
    });
    expect(r.events.find(e => e.category === 'ransomware')?.evidence).toBe('claim');
    expect(r.events.find(e => e.category === 'vulnerability')?.evidence).toBe('official');
  });
});

describe('Cyber (ransomware + CISA KEV)', () => {
  const kev = [{ cveID: 'CVE-2026-0001', vendorProject: 'Acme', product: 'Router', dateAdded: '2026-11-19', shortDescription: 'Bad bug', knownRansomwareCampaignUse: 'Known' }];
  it('warns when one feed is down but still returns the other', () => {
    const r = normalizeCyber({ victims: null, kev });
    expect(r.warnings).toEqual(['ransomware.live unavailable']);
    expect(r.parts?.map(p => [p.name, p.ok])).toEqual([['ransomware.live', false], ['CISA KEV', true]]);
    expect(r.events).toHaveLength(1);
    expect(isMappable(r.events[0])).toBe(false);
  });
  it('throws when both feeds are down', () => {
    expect(() => normalizeCyber({ victims: null, kev: null })).toThrow(/both unavailable/);
  });
});

describe('Multi-feed parts', () => {
  it('news sources report one part per feed, with the failed feed marked not ok', () => {
    const items = [
      { title: 'Ransomware gang leaks data from hospital', link: 'https://a/1', date: '2026-11-20T08:00:00Z', description: '', feed: 'Krebs' },
      { title: 'Ransomware attack hits a school', link: 'https://a/2', date: '2026-11-20T08:00:00Z', description: '', feed: 'The Record' },
    ];
    const r = normalizeCyberNews({ items: items.slice(0, 1), feeds: [{ name: 'Krebs', ok: true }, { name: 'The Record', ok: false }] });
    expect(r.parts).toEqual([
      { name: 'Krebs', ok: true, events: r.events },
      { name: 'The Record', ok: false, events: [] },
    ]);
  });
  it('science reports flares, storms and asteroids separately', () => {
    const r = normalizeScience({ flr: [], gst: [], neo: null });
    expect(r.parts?.map(p => [p.name, p.ok])).toEqual([['solar flares', true], ['geomagnetic storms', true], ['asteroids', false]]);
  });
});

describe('Science', () => {
  it('throws when every NASA feed failed, and warns when only some did', () => {
    expect(() => normalizeScience({ flr: null, gst: null, neo: null })).toThrow();
    const r = normalizeScience({ flr: [], gst: [], neo: null });
    expect(r.warnings.join(' ')).toMatch(/asteroids/);
  });
});

describe('NASA FIRMS', () => {
  it('rejects an HTML error page instead of parsing it', () => {
    expect(() => normalizeFirms('<html>Invalid key</html>')).toThrow(/HTML/);
  });
});
