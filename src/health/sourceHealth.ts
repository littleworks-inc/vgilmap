/**
 * Data-source health model.
 *
 * Why this exists: most "problems" with the data were invisible. A source that is down, a
 * source that is up but returning nothing, and a source returning only years-old items all
 * look the same on the map: nothing. This classifies each source so the UI can say which.
 */
import type { Domain, VigilEvent } from '../types';

export type HealthStatus =
  | 'loading'   // first fetch still in flight
  | 'ok'        // returned recent events
  | 'degraded'  // returned events, but a part of the source failed (see warnings)
  | 'stale'     // returned events, but the newest is older than this source should produce
  | 'empty'     // request succeeded but returned no events
  | 'error';    // request failed

export interface SourceHealth {
  key: string;
  label: string;
  domain: Domain;
  status: HealthStatus;
  count: number;
  newestAt?: string;      // ISO timestamp of the newest event
  lastOkAt?: number;      // epoch ms of the last time this source had events
  error?: string;
  warnings: string[];
  durationMs?: number;
  checkedAt?: number;     // epoch ms of the last completed attempt
  startedAt?: number;     // epoch ms when the first fetch began (used to show how long it's been loading)
}

export const STATUS_META: Record<HealthStatus, { label: string; color: string; hint: string }> = {
  loading:  { label: 'Loading',  color: '#64748b', hint: 'First fetch in progress' },
  ok:       { label: 'Live',     color: '#22c55e', hint: 'Returned recent events' },
  degraded: { label: 'Partial',  color: '#eab308', hint: 'Working, but part of this source failed' },
  stale:    { label: 'Stale',    color: '#f97316', hint: 'Returning only old events' },
  empty:    { label: 'No data',  color: '#94a3b8', hint: 'Responded, but returned no events' },
  error:    { label: 'Down',     color: '#ef4444', hint: 'Request failed' },
};

/** Classify a successful fetch. */
export function classify(
  events: VigilEvent[],
  staleAfterHours: number,
  warnings: string[],
  now: number,
): { status: HealthStatus; newestAt?: string } {
  if (events.length === 0) return { status: 'empty' };

  let newest = 0;
  for (const ev of events) {
    const t = new Date(ev.timestamp).getTime();
    if (!Number.isNaN(t) && t > newest) newest = t;
  }
  const newestAt = newest > 0 ? new Date(newest).toISOString() : undefined;
  if (newest > 0 && now - newest > staleAfterHours * 3_600_000) return { status: 'stale', newestAt };
  return { status: warnings.length > 0 ? 'degraded' : 'ok', newestAt };
}

/** Order used to find the worst status across all sources (higher = worse). */
const SEVERITY: Record<HealthStatus, number> = {
  ok: 0, loading: 1, degraded: 2, empty: 3, stale: 4, error: 5,
};

export function summarize(sources: SourceHealth[]): { live: number; total: number; worst: HealthStatus } {
  let worst: HealthStatus = 'ok';
  let live = 0;
  for (const s of sources) {
    if (s.status === 'ok' || s.status === 'degraded') live++;
    if (SEVERITY[s.status] > SEVERITY[worst]) worst = s.status;
  }
  return { live, total: sources.length, worst };
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
