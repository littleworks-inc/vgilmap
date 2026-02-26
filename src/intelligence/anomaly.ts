/**
 * anomaly.ts — Statistical anomaly detection for VigilMap
 *
 * Uses Welford's online algorithm to compute a rolling mean and
 * variance from the current event window, then flags geographic
 * cells and domain combinations where current density is a
 * statistically significant deviation (z-score) above baseline.
 *
 * No external dependencies. No backend required.
 * Runs entirely in the browser on the current event array.
 */
import type { VigilEvent, Domain } from '../types';
import { DOMAIN_COLORS, DOMAIN_ICONS } from '../types';

// ─── Types ────────────────────────────────────────────────

export interface AnomalySignal {
  id: string;               // stable key: "domain:cellKey"
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

// Satisfy TS: DOMAIN_COLORS is imported but used indirectly by consumers of
// AnomalySignal who may want to colour by domain.  Re-export for convenience.
export { DOMAIN_COLORS };

// ─── Main export ──────────────────────────────────────────

/**
 * Analyse events and return anomaly signals sorted by z-score desc.
 *
 * Algorithm:
 *  1. Group events by domain + 10°×10° geographic cell
 *  2. For each domain, compute per-cell event counts
 *  3. Run Welford's algorithm across all cells to get mean + stddev
 *  4. Z-score each cell: z = (count - mean) / stddev
 *  5. Return cells above Z_ELEVATED threshold as AnomalySignal[]
 */
export function detectAnomalies(events: VigilEvent[]): AnomalySignal[] {
  if (events.length === 0) return [];

  // Step 1 — group events by domain → cell → events[]
  const groups = new Map<string, Map<string, VigilEvent[]>>();

  for (const ev of events) {
    if (!ev.location?.lat || !ev.location?.lng) continue;
    const key = cellKey(ev.location.lat, ev.location.lng);
    if (!groups.has(ev.domain)) groups.set(ev.domain, new Map());
    const domainMap = groups.get(ev.domain)!;
    if (!domainMap.has(key)) domainMap.set(key, []);
    domainMap.get(key)!.push(ev);
  }

  const signals: AnomalySignal[] = [];

  // Step 2-5 — per domain, run Welford across cells, z-score each
  for (const [domain, cellMap] of groups) {
    const cells = Array.from(cellMap.entries());
    if (cells.length < 2) continue; // need ≥2 cells to compute variance

    // Welford pass over all cell counts for this domain
    let state: WelfordState = { n: 0, mean: 0, M2: 0 };
    for (const [, evs] of cells) {
      state = welfordUpdate(state, evs.length);
    }

    const { mean, stddev } = welfordFinalize(state);

    // If stddev is ~0 all cells are equal — no anomaly
    if (stddev < 0.5) continue;

    // Score each cell
    for (const [key, evs] of cells) {
      if (evs.length < MIN_EVENTS_FOR_SIGNAL) continue;

      const zscore = (evs.length - mean) / stddev;
      if (zscore < Z_ELEVATED) continue;

      const severity: AnomalySignal['severity'] =
        zscore >= Z_CRITICAL    ? 'critical'    :
        zscore >= Z_SIGNIFICANT ? 'significant' :
        'elevated';

      const centre = cellCentre(key);
      const label  = regionLabel(evs, centre.lat, centre.lng);

      signals.push({
        id:          `${domain}:${key}`,
        domain:      domain as Domain,
        label:       `${DOMAIN_ICONS[domain as Domain] ?? '🌐'} ${label}`,
        count:       evs.length,
        zscore:      Math.round(zscore * 10) / 10,
        severity,
        lat:         centre.lat,
        lng:         centre.lng,
        regionLabel: label,
        events:      evs,
      });
    }
  }

  // Sort: critical first, then by zscore desc
  return signals.sort((a, b) => {
    const sOrder = { critical: 2, significant: 1, elevated: 0 };
    const diff = sOrder[b.severity] - sOrder[a.severity];
    return diff !== 0 ? diff : b.zscore - a.zscore;
  });
}
