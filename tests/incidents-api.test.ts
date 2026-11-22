import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../shared/pipeline/engine';
import { QueryError } from '../shared/pipeline/query';
import type { EvidenceKind, VigilEvent } from '../shared/types';
import { runIncidents } from '../api/_lib/pipeline';
import { ev, loader, NOW } from './helpers';

const DAY = 24 * 3_600_000;
const iso = (days: number) => new Date(NOW - days * DAY).toISOString();

function rep(id: string, org: string, evidence: EvidenceKind, daysAgo: number, over: Partial<VigilEvent> = {}): VigilEvent {
  return ev(id, {
    domain: 'cyber', category: 'ransomware', severity: 'medium', timestamp: iso(daysAgo), evidence,
    source: evidence === 'claim' ? 'ransomware.live' : evidence === 'catalog' ? 'Have I Been Pwned' : 'The Record',
    location: { lat: 1, lng: 2, country: 'US', region: '', label: 'US', precision: 'country' },
    metadata: { [evidence === 'claim' ? 'victim' : 'impacted']: org, countryCode: 'US' }, ...over,
  });
}

/** Three cyber sources, like production: the same incident arrives from different ones. */
const loaders = () => [
  loader('cyber', () => ({ events: [rep('c1', 'Acme', 'claim', 3), rep('c2', 'Globex', 'claim', 2)], warnings: [] }), { domain: 'cyber' }),
  loader('cyber-news', () => ({ events: [rep('n1', 'Acme', 'confirmed', 2, { source: 'The Record' }), rep('n2', 'Initech', 'report', 1)], warnings: [] }), { domain: 'cyber' }),
  loader('cyber-breaches', () => ({ events: [rep('h1', 'Acme', 'catalog', 1)], warnings: [] }), { domain: 'cyber' }),
  loader('usgs-day', () => ({ events: [ev('q1')], warnings: [] }), { domain: 'disaster' }),
];
const run = (qs = '', ls = loaders()) => runIncidents(new URLSearchParams(qs), { loaders: ls, store: new MemoryStore(), now: () => NOW });

describe('/api/v1/incidents', () => {
  it('groups reports that arrive from DIFFERENT sources, and only looks at the cyber sources', async () => {
    const body = await run();
    expect(body.sources.map(s => s.key)).toEqual(['cyber', 'cyber-news', 'cyber-breaches']); // no earthquakes
    expect(body.total).toBe(3);                // Acme, Globex, Initech: three incidents...
    expect(body.total_reports).toBe(5);        // ...from five reports
    const acme = body.data.find(i => i.reportCount === 3)!;
    expect(acme.org).toBe('Acme');
    expect(acme.sources.sort()).toEqual(['Have I Been Pwned', 'The Record', 'ransomware.live']);
    expect(acme.evidence).toEqual(['confirmed', 'catalog', 'claim']);
  });

  it('summarizes incidents, not reports', async () => {
    const { summary } = await run();
    expect(summary).toMatchObject({ incidents: 3, multi_report: 1 });
    expect(summary).not.toHaveProperty('corroborated'); // multiple reports are not independent corroboration
    expect(summary.by_evidence).toEqual({ confirmed: 1, catalog: 1, claim: 2, report: 1 });
  });

  it('min_reports keeps only multi_report incidents', async () => {
    const body = await run('min_reports=2');
    expect(body.data.map(i => i.org)).toEqual(['Acme']);
    expect(body.total).toBe(1);
  });

  it('applies filters to the reports BEFORE grouping', async () => {
    const withSeverity = [
      loader('cyber', () => ({ events: [rep('c1', 'Acme', 'claim', 3, { severity: 'critical' })], warnings: [] }), { domain: 'cyber' }),
      loader('cyber-news', () => ({ events: [rep('n1', 'Acme', 'report', 2, { severity: 'low' })], warnings: [] }), { domain: 'cyber' }),
    ];
    const body = await run('severity=high', withSeverity);
    expect(body.data[0].reportCount).toBe(1); // the low-severity report is filtered out first
  });

  it('never turns CISA KEV vulnerabilities into incidents', async () => {
    const kev = rep('k1', 'Acme', 'official', 0, { category: 'vulnerability' });
    const body = await run('', [loader('cyber', () => ({ events: [kev, rep('c1', 'Acme', 'claim', 1)], warnings: [] }), { domain: 'cyber' })]);
    expect(body.total).toBe(1);
    expect(body.data[0].reports.map(r => r.id)).toEqual(['c1']);
  });

  it('pages incidents with a cursor: every incident exactly once', async () => {
    const many = Array.from({ length: 25 }, (_, i) => rep(`m${i}`, `Org number ${i}`, 'claim', i % 10));
    const ls = [loader('cyber', () => ({ events: many, warnings: [] }), { domain: 'cyber' })];
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const body: Awaited<ReturnType<typeof run>> = await run(`limit=10${cursor ? `&cursor=${cursor}` : ''}`, ls);
      expect(body.total).toBe(25);
      seen.push(...body.data.map(i => i.id));
      cursor = body.next_cursor;
    } while (cursor);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it('rejects an invalid min_reports like any other bad filter', async () => {
    for (const bad of ['min_reports=0', 'min_reports=abc', 'min_reports=', 'min_reports=1000']) {
      await expect(run(bad)).rejects.toBeInstanceOf(QueryError);
    }
  });

  it('reports a source that is down without losing the others', async () => {
    const ls = loaders();
    ls[2] = loader('cyber-breaches', () => { throw new Error('HIBP down'); }, { domain: 'cyber' });
    const body = await run('', ls);
    expect(body.ok).toBe(true);
    expect(body.sources.find(s => s.key === 'cyber-breaches')?.status).toBe('error');
    expect(body.data.find(i => i.org === 'Acme')?.reportCount).toBe(2); // grouping still works on what is available
  });
});
