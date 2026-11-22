/**
 * Merging, filtering, pagination and summaries: one implementation, used by every endpoint, so
 * totals and pages always agree. Totals are computed on the full filtered set BEFORE pagination.
 */
import type { Domain, Severity, VigilEvent } from '../types';
import { isMappable } from '../types';
import type { SourceResult, SourceStatus } from './engine';

export const API_VERSION = '1.1.0';
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;

const SEVERITY_ORDER: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const DOMAINS: Domain[] = ['health', 'climate', 'conflict', 'economic', 'disaster', 'labor', 'science', 'cyber'];

export interface EventQuery {
  domains?: Domain[];
  minSeverity?: Severity;
  /** Epoch ms: drop events older than this. */
  since?: number;
  sources?: string[];
  /** 'map' = events with a place; 'nomap' = list-only events. */
  location: 'all' | 'map' | 'nomap';
  limit: number;
  offset: number;
}

const list = (v: string | null) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined);
const int = (v: string | null, fallback: number) => { const n = parseInt(v ?? '', 10); return Number.isFinite(n) ? n : fallback; };

export function parseQuery(params: URLSearchParams): EventQuery {
  const domains = list(params.get('domain'))?.filter((d): d is Domain => (DOMAINS as string[]).includes(d));
  const sev = params.get('severity') as Severity | null;
  const since = params.get('since') ? new Date(params.get('since')!).getTime() : NaN;
  const loc = params.get('location');
  return {
    domains: domains && domains.length > 0 ? domains : undefined,
    minSeverity: sev && sev in SEVERITY_ORDER ? sev : undefined,
    since: Number.isNaN(since) ? undefined : since,
    sources: list(params.get('source')),
    location: loc === 'map' || loc === 'nomap' ? loc : 'all',
    limit: Math.min(Math.max(int(params.get('limit'), DEFAULT_LIMIT), 1), MAX_LIMIT),
    offset: Math.max(int(params.get('offset'), 0), 0),
  };
}

/** Merge per-source results: drop duplicate ids (first source wins), newest first. */
export function mergeEvents(results: Array<{ events: VigilEvent[] }>): VigilEvent[] {
  const seen = new Set<string>();
  const out: VigilEvent[] = [];
  for (const r of results) {
    for (const ev of r.events) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      out.push(ev);
    }
  }
  return out.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/** Every filter except pagination. */
export function filterEvents(events: VigilEvent[], q: EventQuery): VigilEvent[] {
  const domains = q.domains ? new Set<string>(q.domains) : null;
  const min = q.minSeverity ? SEVERITY_ORDER[q.minSeverity] : 0;
  return events.filter(e => {
    if (domains && !domains.has(e.domain)) return false;
    if (SEVERITY_ORDER[e.severity] < min) return false;
    if (q.since !== undefined && new Date(e.timestamp).getTime() < q.since) return false;
    if (q.location === 'map' && !isMappable(e)) return false;
    if (q.location === 'nomap' && isMappable(e)) return false;
    return true;
  });
}

export function paginate<T>(items: T[], q: Pick<EventQuery, 'limit' | 'offset'>): { page: T[]; nextOffset: number | null } {
  const page = items.slice(q.offset, q.offset + q.limit);
  const next = q.offset + page.length;
  return { page, nextOffset: next < items.length ? next : null };
}

export function summarize(events: VigilEvent[]) {
  const by_domain: Record<string, number> = {};
  const by_severity: Record<string, number> = {};
  const by_precision: Record<string, number> = {};
  for (const e of events) {
    by_domain[e.domain] = (by_domain[e.domain] ?? 0) + 1;
    by_severity[e.severity] = (by_severity[e.severity] ?? 0) + 1;
    const p = e.location.precision ?? 'unknown';
    by_precision[p] = (by_precision[p] ?? 0) + 1;
  }
  const top_events = events
    .filter(e => e.severity === 'critical' || e.severity === 'high')
    .sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5)
    .map(e => ({ id: e.id, title: e.title, severity: e.severity, domain: e.domain, source: e.source, location: e.location.label }));
  return { total: events.length, by_domain, by_severity, by_precision, top_events };
}

export interface EventsResponse {
  ok: boolean;
  version: string;
  generated: string;
  count: number;              // events in this page
  total: number;              // events matching the filters, before pagination
  total_unfiltered: number;   // events from the selected sources, before any filter
  next_offset: number | null;
  summary: ReturnType<typeof summarize>;
  sources: SourceStatus[];
  data: VigilEvent[];
}

/** Build the one response shape every endpoint shares. */
export function buildEventsResponse(results: SourceResult[], q: EventQuery, now: number = Date.now()): EventsResponse {
  const merged = mergeEvents(results);
  const filtered = filterEvents(merged, q);
  const { page, nextOffset } = paginate(filtered, q);
  const sources = results.map(r => r.status);
  // "ok" means at least one selected source produced data (live or retained).
  const ok = results.length === 0 || results.some(r => r.status.status !== 'error' || r.status.retained);
  return {
    ok, version: API_VERSION, generated: new Date(now).toISOString(),
    count: page.length, total: filtered.length, total_unfiltered: merged.length,
    next_offset: nextOffset, summary: summarize(filtered), sources, data: page,
  };
}
