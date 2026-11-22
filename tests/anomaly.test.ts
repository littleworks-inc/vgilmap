import { describe, expect, it } from 'vitest';
import { detectAnomalies, anomalySummary } from '../src/intelligence/anomaly';
import type { LocationPrecision } from '../shared/types';
import { ev } from './helpers';

/** `n` events of one domain at one point, with the given location precision. */
function at(prefix: string, n: number, lat: number, lng: number, precision: LocationPrecision, country = 'XX', domain: 'conflict' | 'disaster' = 'conflict') {
  return Array.from({ length: n }, (_, i) => ev(`${prefix}${i}`, { domain, location: { lat, lng, country, region: '', label: country, precision } }));
}

/** A few small groups elsewhere so there is a baseline to compare against. */
const background = (precision: LocationPrecision, domain: 'conflict' | 'disaster' = 'conflict') => [
  ...at('b1-', 1, 40, -100, precision, 'US', domain),
  ...at('b2-', 1, 50, 10, precision, 'DE', domain),
  ...at('b3-', 1, -20, 130, precision, 'AU', domain),
  ...at('b4-', 2, 20, 80, precision, 'IN', domain),
];

describe('country-level reports do not create geographic concentrations', () => {
  const events = [...at('ua-', 8, 49, 32, 'country', 'UA'), ...background('country')];

  it('never appear as a measured cluster, even though they share one coordinate', () => {
    const signals = detectAnomalies(events);
    expect(signals.filter(s => s.basis === 'measured')).toEqual([]);
  });

  it('are counted per country, as reports, instead', () => {
    const reports = detectAnomalies(events).filter(s => s.basis === 'reports');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ basis: 'reports', domain: 'conflict', count: 8 });
    expect(reports[0].label).toMatch(/UA \(reports\)/);
  });

  it('are described to the AI brief as reports naming a country, not as a cluster', () => {
    const text = anomalySummary(detectAnomalies(events));
    expect(text).toMatch(/reports naming UA/);
    expect(text).not.toMatch(/cluster in UA/);
  });
});

describe('measured locations still produce geographic clusters', () => {
  const events = [...at('q-', 8, 35.5, -117.5, 'exact', 'US', 'disaster'), ...background('exact', 'disaster')];

  it('flags a dense cluster of exact positions', () => {
    const signals = detectAnomalies(events);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ basis: 'measured', domain: 'disaster', count: 8 });
    expect(anomalySummary(signals)).toMatch(/cluster in/);
  });

  it('treats area-level positions as measured too', () => {
    const signals = detectAnomalies([...at('a-', 8, 35.5, -117.5, 'area', 'US', 'disaster'), ...background('area', 'disaster')]);
    expect(signals.map(s => s.basis)).toEqual(['measured']);
  });

  it('counts events at exactly 0° latitude or longitude (a valid place, not "missing")', () => {
    const signals = detectAnomalies([...at('eq-', 8, 0, 0.5, 'exact', 'GA', 'disaster'), ...background('exact', 'disaster')]);
    expect(signals).toHaveLength(1);
    expect(signals[0].count).toBe(8);
  });
});

describe('events with no place are excluded from both comparisons', () => {
  it('ignores unlocated events entirely', () => {
    const unlocated = Array.from({ length: 10 }, (_, i) => ev(`u${i}`, { metadata: { unlocated: true }, location: { lat: 0, lng: 0, country: 'Global', region: '', label: 'Global' } }));
    expect(detectAnomalies([...unlocated, ...background('exact')])).toEqual([]);
  });
});

describe('mixed data', () => {
  it('reports both kinds side by side, critical first', () => {
    const events = [
      ...at('ua-', 8, 49, 32, 'country', 'UA'), ...background('country'),
      ...at('q-', 8, 35.5, -117.5, 'exact', 'US', 'disaster'), ...background('exact', 'disaster'),
    ];
    const signals = detectAnomalies(events);
    expect(new Set(signals.map(s => s.basis))).toEqual(new Set(['measured', 'reports']));
    expect(signals.map(s => s.id)).toEqual([...new Set(signals.map(s => s.id))]); // ids are unique
  });
});
