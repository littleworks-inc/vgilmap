/**
 * anomaly.ts — Statistical anomaly detection for VigilMap
 *
 * Finds EVENT CONCENTRATIONS by comparing counts across the currently populated places of each
 * domain (Welford mean/variance, z-score). That is a within-snapshot comparison, NOT a historical
 * anomaly: there is no per-region, per-source baseline yet, so a region that is always busy will
 * still stand out. The UI and AI brief therefore call these "concentrations", not "anomalies".
 *
 * Two kinds, kept apart because they mean different things:
 *   measured — events at a measured position (exact / area precision), grouped in 10° grid cells.
 *   reports  — events only known to a COUNTRY (headlines, WHO, ransomware claims), counted per
 *              country. They are never put on the grid: several unrelated reports that all sit at
 *              one country's centre point would otherwise look like a geographic cluster.
 *
 * No external dependencies. No backend required.
 * Runs entirely in the browser on the current event array.
 */
import type { VigilEvent, Domain } from '../types';
import { DOMAIN_COLORS, DOMAIN_ICONS, isMappable } from '../types';

// ─── Types ────────────────────────────────────────────────

export interface AnomalySignal {
  id: string;               // stable key: "basis:domain:key"
  /** 'measured' = a cluster of positioned events; 'reports' = how many reports name one country. */
  basis: 'measured' | 'reports';
  domain: Domain;
  label: string;            // human readable: "🌋 Seismic — Western US"
  count: number;            // events in this cell
  zscore: number;           // standard deviations above mean
  severity: 'elevated' | 'significant' | 'critical';
  lat: number;              // cell centre lat
  lng: number;              // cell centre lng
  regionLabel: string;      // e.g. "Western US" or "10°N 30°E"
  events: VigilEvent[];     // the events driving this signal
}

// ─── Constants ────────────────────────────────────────────

// Geographic grid resolution in degrees.
// 10° cells balance granularity with statistical significance.
const CELL_SIZE = 10;

// Z-score thresholds
const Z_ELEVATED    = 1.0;   // worth noting
const Z_SIGNIFICANT = 1.5;   // worth flagging
const Z_CRITICAL    = 2.5;   // worth alerting

// Minimum events in a cell to bother computing stats
const MIN_EVENTS_FOR_SIGNAL = 3;

// ─── Grid helpers ─────────────────────────────────────────

function cellKey(lat: number, lng: number): string {
  const row = Math.floor(lat / CELL_SIZE) * CELL_SIZE;
  const col = Math.floor(lng / CELL_SIZE) * CELL_SIZE;
  return `${row}:${col}`;
}

function cellCentre(key: string): { lat: number; lng: number } {
  const [row, col] = key.split(':').map(Number);
  return { lat: row + CELL_SIZE / 2, lng: col + CELL_SIZE / 2 };
}

// ─── Welford's online algorithm ───────────────────────────
// Computes mean and population variance in a single pass.
// See: https://en.wikipedia.org/wiki/Algorithms_for_calculating_variance

interface WelfordState {
  n: number;
  mean: number;
  M2: number;   // sum of squared deviations
}

function welfordUpdate(state: WelfordState, value: number): WelfordState {
  const n      = state.n + 1;
  const delta  = value - state.mean;
  const mean   = state.mean + delta / n;
  const delta2 = value - mean;
  const M2     = state.M2 + delta * delta2;
  return { n, mean, M2 };
}

function welfordFinalize(state: WelfordState): { mean: number; stddev: number } {
  if (state.n < 2) return { mean: state.mean, stddev: 0 };
  const variance = state.M2 / state.n;   // population variance
  return { mean: state.mean, stddev: Math.sqrt(variance) };
}

// ─── Region label ─────────────────────────────────────────

function regionLabel(
  events: VigilEvent[],
  cellLat: number,
  cellLng: number
): string {
  // Try to use a real location label from the events
  const labels = events
    .map(e => e.location.region || e.location.country)
    .filter(Boolean) as string[];

  if (labels.length > 0) {
    // Most common label in this cell
    const freq: Record<string, number> = {};
    for (const l of labels) freq[l] = (freq[l] ?? 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
    return top;
  }

  // Fallback: cardinal direction + rough lat/lng
  const ns = cellLat >= 0 ? 'N' : 'S';
  const ew = cellLng >= 0 ? 'E' : 'W';
  return `${Math.abs(Math.round(cellLat))}°${ns} ${Math.abs(Math.round(cellLng))}°${ew}`;
}

// Re-export for consumers (e.g. AnomalyPanel) that need domain colours.
export { DOMAIN_COLORS };

/**
 * Produce a compact text summary of anomaly signals for use as AI brief context.
 * e.g. "3 signals — critical: Seismic Japan (3.1σ); significant: Health DRC (2.0σ)"
 */
export function anomalySummary(signals: AnomalySignal[]): string {
  if (signals.length === 0) return 'no unusual event concentrations detected';
  const parts = signals.slice(0, 4).map(
    s => `${s.severity} ${s.domain} ${s.basis === 'reports' ? 'reports naming' : 'cluster in'} ${s.regionLabel.replace(' (reports)', '')} (${s.zscore}σ, ${s.count} ${s.basis === 'reports' ? 'reports' : 'events'})`
  );
  return `${signals.length} concentration${signals.length > 1 ? 's' : ''} vs. other regions in this snapshot (not a historical baseline; 'reports' counts how many reports name a country, not a place where something happened) — ${parts.join('; ')}`;
}

// ─── Main export ──────────────────────────────────────────

/** Does this event have a position we measured (or an area we know), as opposed to a country guess? */
function isMeasured(ev: VigilEvent): boolean {
  return ev.location.precision !== 'country';
}

type Groups = Map<string, Map<string, VigilEvent[]>>;

function addTo(groups: Groups, domain: string, key: string, ev: VigilEvent) {
  if (!groups.has(domain)) groups.set(domain, new Map());
  const m = groups.get(domain)!;
  if (!m.has(key)) m.set(key, []);
  m.get(key)!.push(ev);
}

/** Score every group within each domain against the other groups of that domain. */
function score(
  groups: Groups,
  basis: AnomalySignal['basis'],
  place: (key: string, evs: VigilEvent[]) => { lat: number; lng: number; label: string },
): AnomalySignal[] {
  const signals: AnomalySignal[] = [];
  for (const [domain, cellMap] of groups) {
    const cells = Array.from(cellMap.entries());
    if (cells.length < 2) continue; // need ≥2 groups to compute variance

    let state: WelfordState = { n: 0, mean: 0, M2: 0 };
    for (const [, evs] of cells) state = welfordUpdate(state, evs.length);
    const { mean, stddev } = welfordFinalize(state);
    if (stddev < 0.5) continue; // all groups equal: nothing stands out

    for (const [key, evs] of cells) {
      if (evs.length < MIN_EVENTS_FOR_SIGNAL) continue;
      const zscore = (evs.length - mean) / stddev;
      if (zscore < Z_ELEVATED) continue;

      const severity: AnomalySignal['severity'] =
        zscore >= Z_CRITICAL ? 'critical' : zscore >= Z_SIGNIFICANT ? 'significant' : 'elevated';
      const where = place(key, evs);
      signals.push({
        id: `${basis}:${domain}:${key}`,
        basis,
        domain: domain as Domain,
        label: `${DOMAIN_ICONS[domain as Domain] ?? '🌐'} ${where.label}`,
        count: evs.length,
        zscore: Math.round(zscore * 10) / 10,
        severity,
        lat: where.lat,
        lng: where.lng,
        regionLabel: where.label,
        events: evs,
      });
    }
  }
  return signals;
}

/**
 * Analyse events and return concentration signals, critical first then by z-score.
 *
 *  1. measured: group positioned events by domain + 10°×10° cell, z-score the cell counts
 *  2. reports: group country-level events by domain + country, z-score the per-country counts
 */
export function detectAnomalies(events: VigilEvent[]): AnomalySignal[] {
  const cells: Groups = new Map();
  const countries: Groups = new Map();

  for (const ev of events) {
    if (!isMappable(ev)) continue; // no real place: never part of a geographic comparison
    if (isMeasured(ev)) addTo(cells, ev.domain, cellKey(ev.location.lat, ev.location.lng), ev);
    else addTo(countries, ev.domain, ev.location.country || ev.location.label, ev);
  }

  const signals = [
    ...score(cells, 'measured', (key, evs) => {
      const c = cellCentre(key);
      return { lat: c.lat, lng: c.lng, label: regionLabel(evs, c.lat, c.lng) };
    }),
    ...score(countries, 'reports', (_key, evs) => ({
      lat: evs[0].location.lat, lng: evs[0].location.lng,
      label: `${evs[0].location.label || evs[0].location.country} (reports)`,
    })),
  ];

  const sOrder = { critical: 2, significant: 1, elevated: 0 };
  return signals.sort((a, b) => sOrder[b.severity] - sOrder[a.severity] || b.zscore - a.zscore);
}
