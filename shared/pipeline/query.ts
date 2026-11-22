/**
 * Merging, filtering, pagination and summaries: one implementation, used by every endpoint, so
 * totals and pages always agree. Totals are computed on the full filtered set BEFORE pagination.
 */
import type { Domain, Severity, VigilEvent } from '../types';
import { isExpired, isMappable } from '../types';
import type { SourceResult, SourceStatus } from './engine';

export const API_VERSION = '1.3.0';
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
  /** 'active' (default) hides events whose `expiresAt` has passed; 'expired' shows only those; 'all' both. */
  lifecycle: 'active' | 'expired' | 'all';
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

/**
 * A comma-separated filter. Present-but-empty ("?source=" or "?domain=,") is an error: it would
 * otherwise quietly fall back to "everything", which looks like a legitimate result.
 */
function list(params: URLSearchParams, name: string): string[] | undefined {
  if (!params.has(name)) return undefined;
  const values = (params.get(name) ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (values.length === 0) throw new QueryError(`"${name}" is empty: give at least one value, or leave the parameter out`);
  return values;
}

/** A parameter that takes a single value must not be present-but-empty either. */
function single(params: URLSearchParams, name: string): string | null {
  if (!params.has(name)) return null;
  const v = (params.get(name) ?? '').trim();
  if (!v) throw new QueryError(`"${name}" is empty: give a value, or leave the parameter out`);
  return v;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Strict ISO 8601 date or date-time. Impossible dates (2026-02-30) are rejected, not rolled into March. */
export function parseIsoStrict(raw: string): number {
  const m = ISO.exec(raw);
  if (!m) return NaN;
  const [y, mo, d, h = '0', mi = '0', sec = '0'] = m.slice(1, 7);
  const [Y, M, D, H, MI, S] = [y, mo, d, h, mi, sec].map(Number);
  if (M < 1 || M > 12 || H > 23 || MI > 59 || S > 59) return NaN;
  const probe = new Date(Date.UTC(Y, M - 1, D));
  if (probe.getUTCMonth() !== M - 1 || probe.getUTCDate() !== D) return NaN; // day not in that month
  return new Date(m[7] || !m[4] ? raw.replace(' ', 'T') : `${raw.replace(' ', 'T')}Z`).getTime();
}

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

  const domains = list(params, 'domain');
  const sources = list(params, 'source');
  const sev = single(params, 'severity');
  const sinceRaw = single(params, 'since');
  const loc = single(params, 'location');
  const life = single(params, 'lifecycle');
  const limitRaw = single(params, 'limit');
  const cursorRaw = single(params, 'cursor');

  const q: EventQuery = { location: 'all', lifecycle: 'active', limit: DEFAULT_LIMIT };
  if (domains) q.domains = oneOf('domain', domains, DOMAINS);
  if (sources) q.sources = oneOf('source', sources, known.sources);
  if (sev) q.minSeverity = oneOf('severity', [sev], Object.keys(SEVERITY_ORDER) as Severity[])[0];
  if (sinceRaw) {
    const t = parseIsoStrict(sinceRaw);
    if (Number.isNaN(t)) throw new QueryError(`Invalid "since" "${sinceRaw}": use a real ISO 8601 date or timestamp, e.g. 2026-11-20 or 2026-11-20T00:00:00Z`);
    q.since = t;
  }
  if (loc) q.location = oneOf('location', [loc], ['all', 'map', 'nomap'] as const)[0];
  if (life) q.lifecycle = oneOf('lifecycle', [life], ['active', 'expired', 'all'] as const)[0];
  if (limitRaw !== null) {
    const n = /^\d+$/.test(limitRaw) ? parseInt(limitRaw, 10) : NaN;
    if (!(n >= 1 && n <= MAX_LIMIT)) throw new QueryError(`Invalid "limit" "${limitRaw}": use a whole number from 1 to ${MAX_LIMIT}`);
    q.limit = n;
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
export function filterEvents(events: VigilEvent[], q: EventQuery, now: number = Date.now()): VigilEvent[] {
  const domains = q.domains ? new Set<string>(q.domains) : null;
  const min = q.minSeverity ? SEVERITY_ORDER[q.minSeverity] : 0;
  return events.filter(e => {
    if (domains && !domains.has(e.domain)) return false;
    if (SEVERITY_ORDER[e.severity] < min) return false;
    if (q.since !== undefined && new Date(e.timestamp).getTime() < q.since) return false;
    if (q.location === 'map' && !isMappable(e)) return false;
    if (q.location === 'nomap' && isMappable(e)) return false;
    if (q.lifecycle !== 'all' && isExpired(e, now) !== (q.lifecycle === 'expired')) return false;
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
  /** Events in the selected sources whose `expiresAt` has passed (hidden unless ?lifecycle=expired|all). */
  total_expired: number;
  /** The earliest moment a currently active, matching event ends: the response is stale after it. */
  next_expiry: string | null;
  /** Pass as ?cursor= to get the next page; null on the last page. */
  next_cursor: string | null;
  summary: ReturnType<typeof summarize>;
  sources: SourceStatus[];
  data: VigilEvent[];
}

/** Build the one response shape every endpoint shares. */
export function buildEventsResponse(results: SourceResult[], q: EventQuery, now: number = Date.now()): EventsResponse {
  const merged = mergeEvents(results);
  const filtered = filterEvents(merged, q, now);
  const { page: rawPage, nextCursor } = paginate(filtered, q);
  // Lifecycle is stamped at read time, from the clock, so a cached or retained event never claims to be current.
  const page = rawPage.map(e => ({ ...e, lifecycle: isExpired(e, now) ? 'expired' as const : 'active' as const }));
  const upcoming = filtered.map(e => (e.expiresAt ? Date.parse(e.expiresAt) : NaN)).filter(t => Number.isFinite(t) && t > now);
  const sources = results.map(r => r.status);
  // "ok" means at least one selected source produced data (live or retained).
  const ok = results.length === 0 || results.some(r => r.status.status !== 'error' || r.status.retained);
  return {
    ok, version: API_VERSION, generated: new Date(now).toISOString(),
    count: page.length, total: filtered.length, total_unfiltered: merged.length,
    total_expired: merged.filter(e => isExpired(e, now)).length,
    next_expiry: upcoming.length > 0 ? new Date(Math.min(...upcoming)).toISOString() : null,
    next_cursor: nextCursor, summary: summarize(filtered), sources, data: page,
  };
}
