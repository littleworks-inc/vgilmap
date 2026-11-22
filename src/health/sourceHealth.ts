/**
 * Data-source health, UI side. The status model and classifier are shared with the server
 * pipeline (shared/pipeline/health.ts); this file adds what only the panel needs.
 */
import type { Domain } from '../types';
import type { HealthStatus } from '../../shared/pipeline/health';
import type { SourceStatus } from '../../shared/pipeline/engine';

export { classify } from '../../shared/pipeline/health';
export type { HealthStatus };

/** A source's status as the UI tracks it: the server's report plus client-only fields. */
export interface SourceHealth extends Partial<Omit<SourceStatus, 'status' | 'key' | 'label' | 'domain' | 'warnings'>> {
  key: string;
  label: string;
  domain: Domain;
  status: HealthStatus;
  count: number;
  warnings: string[];
  lastOkAt?: number;      // epoch ms of the last time this source had events
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

/** Order used to find the worst status across all sources (higher = worse). */
const SEVERITY: Record<HealthStatus, number> = {
  ok: 0, loading: 1, degraded: 2, empty: 3, stale: 4, error: 5,
};

export function summarize(sources: SourceHealth[]): { live: number; total: number; worst: HealthStatus } {
  let worst: HealthStatus = 'ok';
  let live = 0;
  // Optional sources are listed in the panel but don't count toward the headline numbers or colour.
  sources = sources.filter(s => !s.optional);
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
