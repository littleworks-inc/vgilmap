/**
 * Merging, filtering, pagination and summaries: one implementation, used by every endpoint, so
 * totals and pages always agree. Totals are computed on the full filtered set BEFORE pagination.
 */
import type { Domain, Severity, VigilEvent } from '../types';
import { isMappable } from '../types';
import type { SourceResult, SourceStatus } from './engine';

export const API_VERSION = '1.2.0';
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;

const SEVERITY_ORDER: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const DOMAINS: Domain[] = ['health', 'climate', 'conflict', 'economic', 'disaster', 'labor', 'science', 'cyber'];

/** A position in the stable event order (newest first, ties by id): "continue after this event". */
export interface Cursor { ts: number; id: string }

export interface EventQuery {
  domains?: Domain[];
  minSeverity?: Severity;
  /** Epoch ms: drop events older than this. */
  since?: number;
  sources?: string[];
  /** 'map' = events with a place; 'nomap' = list-only events. */
  location: 'all' | 'map' | 'nomap';
  limit: number;
  cursor?: Cursor;
}

/** A request the API refuses (HTTP 400), with the values that would have been accepted. */
export class QueryError extends Error {
  readonly valid?: string[];
  constructor(message: string, valid?: string[]) { super(message); this.name = 'QueryError'; this.valid = valid; }
}

export function encodeCursor(ev: { timestamp: string; id: string }): string {
  return btoa(`${new Date(ev.timestamp).getTime()}|${ev.id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(raw: string): Cursor {
  try {
    const [ts, ...rest] = atob(raw.replace(/-/g, '+').replace(/_/g, '/')).split('|');
    const id = rest.join('|');
    if (Number.isFinite(Number(ts)) && id) return { ts: Number(ts), id };
  } catch { /* fall through */ }
  throw new QueryError('Invalid "cursor": pass the next_cursor value from a previous response unchanged');
}

const list = (v: string | null) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined);

function oneOf<T extends string>(name: string, values: string[], allowed: readonly T[]): T[] {
  const bad = values.filter(v => !(allowed as readonly string[]).includes(v));
  if (bad.length > 0) throw new QueryError(`Unknown ${name} ${bad.map(b => `"${b}"`).join(', ')}`, [...allowed]);
  return values as T[];
}

/**
 * Parse and VALIDATE the query string. Anything unsupported is an error, never silently ignored,
 * because a typo that quietly widens the filter looks exactly like a legitimate result.
 * `known.sources` is the list of valid source keys.
 */
export function parseQuery(params: URLSearchParams, known: { sources: string[] }): EventQuery {
  if (params.has('offset')) throw new QueryError('"offset" was replaced by "cursor": pass next_cursor from the previous response (offsets shift when new events arrive)');

  const domains = list(params.get('domain'));
  const sources = list(params.get('source'));
  const sev = params.get('severity');
  const sinceRaw = params.get('since');
  const loc = params.get('location');
  const limitRaw = params.get('limit');
  const cursorRaw = params.get('cursor');

  const q: EventQuery = { location: 'all', limit: DEFAULT_LIMIT };
  if (domains) q.domains = oneOf('domain', domains, DOMAINS);
  if (sources) q.sources = oneOf('source', sources, known.sources);
  if (sev) q.minSeverity = oneOf('severity', [sev], Object.keys(SEVERITY_ORDER) as Severity[])[0];
  if (sinceRaw) {
    const t = new Date(sinceRaw).getTime();
    if (Number.isNaN(t)) throw new QueryError(`Invalid "since" "${sinceRaw}": use an ISO 8601 timestamp, e.g. 2026-11-20T00:00:00Z`);
    q.since = t;
  }
  if (loc) q.location = oneOf('location', [loc], ['all', 'map', 'nomap'] as const)[0];
  if (limitRaw !== null) {
    if (!/^\d+$/.test(limitRaw)) throw new QueryError(`Invalid "limit" "${limitRaw}": use a whole number from 1 to ${MAX_LIMIT}`);
    q.limit = Math.min(Math.max(parseInt(limitRaw, 10), 1), MAX_LIMIT);
  }
  if (cursorRaw) q.cursor = decodeCursor(cursorRaw);
  return q;
}

/** The one stable order: newest first, ties broken by id (so pagination never reorders). */
export function compareEvents(a: { timestamp: string; id: string }, b: { timestamp: string; id: string }): number {
  const d = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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
  return out.sort(compareEvents);
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

/**
 * Keyset pagination over events already in `compareEvents` order: the page after `cursor`, and the
 * cursor for the next one. Unlike an offset it cannot repeat or skip events when new ones arrive.
 */
export function paginate<T extends { timestamp: string; id: string }>(items: T[], q: Pick<EventQuery, 'limit' | 'cursor'>): { page: T[]; nextCursor: string | null } {
  let start = 0;
  if (q.cursor) {
    const c = q.cursor;
    start = items.findIndex(e => {
      const ts = new Date(e.timestamp).getTime();
      return ts < c.ts || (ts === c.ts && e.id > c.id);
    });
    if (start < 0) start = items.length;
  }
  const page = items.slice(start, start + q.limit);
  const more = start + page.length < items.length;
  return { page, nextCursor: more && page.length > 0 ? encodeCursor(page[page.length - 1]) : null };
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
  /** Pass as ?cursor= to get the next page; null on the last page. */
  next_cursor: string | null;
  summary: ReturnType<typeof summarize>;
  sources: SourceStatus[];
  data: VigilEvent[];
}

/** Build the one response shape every endpoint shares. */
export function buildEventsResponse(results: SourceResult[], q: EventQuery, now: number = Date.now()): EventsResponse {
  const merged = mergeEvents(results);
  const filtered = filterEvents(merged, q);
  const { page, nextCursor } = paginate(filtered, q);
  const sources = results.map(r => r.status);
  // "ok" means at least one selected source produced data (live or retained).
  const ok = results.length === 0 || results.some(r => r.status.status !== 'error' || r.status.retained);
  return {
    ok, version: API_VERSION, generated: new Date(now).toISOString(),
    count: page.length, total: filtered.length, total_unfiltered: merged.length,
    next_cursor: nextCursor, summary: summarize(filtered), sources, data: page,
  };
}
