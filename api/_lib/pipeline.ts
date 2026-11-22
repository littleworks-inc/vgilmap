/**
 * The pipeline entry used by every public endpoint: pick sources, run them with last-good
 * retention, and build the one response shape.
 *
 * Last-good data is kept in memory per function instance. That survives a flaky upstream within
 * an instance's lifetime; the CDN cache (s-maxage) and the app's own retained copy cover the rest.
 */
import { MemoryStore, runSources } from '../../shared/pipeline/engine';
import type { LastGoodStore, SourceLoader, SourceResult } from '../../shared/pipeline/engine';
import { buildEventsResponse, parseQuery, QueryError } from '../../shared/pipeline/query';
import { buildIncidentsResponse } from '../../shared/pipeline/incidents';
import type { IncidentsResponse } from '../../shared/pipeline/incidents';
import type { EventsResponse } from '../../shared/pipeline/query';
import { SERVER_LOADERS } from './sources';

const store = new MemoryStore();

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
};

export interface PipelineDeps {
  loaders?: SourceLoader[];
  store?: LastGoodStore;
  now?: () => number;
  timeoutMs?: number;
}

/**
 * Run the sources selected by `?source=` and return the full response body. With no `source`,
 * every non-optional source runs: optional extras (GDELT) are slow and flaky, and would make a
 * whole-dataset request wait for their timeout. Name them in `source=`, or pass `optional=1`.
 */
export async function runPipeline(params: URLSearchParams, deps: PipelineDeps = {}): Promise<{ body: EventsResponse; results: SourceResult[] }> {
  const all = deps.loaders ?? SERVER_LOADERS;
  const q = parseQuery(params, { sources: all.map(l => l.meta.key) });
  const selected = q.sources ? all.filter(l => q.sources!.includes(l.meta.key))
    : params.get('optional') === '1' ? all : all.filter(l => !l.meta.optional);
  const results = await runSources(selected, deps.store ?? store, { now: deps.now, timeoutMs: deps.timeoutMs, reuseFresh: true });
  return { body: buildEventsResponse(results, q, (deps.now ?? Date.now)()), results };
}

/** How long the engine holds a failed or partial snapshot before asking upstream again (see engine.ts). */
const RETRY_AFTER_S = 30;

/**
 * Edge caching follows each source's REMAINING freshness, not its full interval. A WHO snapshot that
 * is already 59 minutes old may be cached for one more minute, not for another hour, or a different
 * query could be served nearly two-hour-old data under a one-hour policy. For a response spanning
 * several sources the shortest remaining time wins. A degraded, partial or failed source is held
 * only for the short retry window (so recovery shows up quickly), and a response with no data at
 * all is never cached. It is also capped at the next moment an alert in the response expires.
 */
export function cacheControl(body: Pick<EventsResponse, 'ok' | 'generated' | 'sources' | 'next_expiry'>): string {
  if (!body.ok) return 'no-store';
  const now = Date.parse(body.generated);
  const remaining = body.sources.map(s => {
    const age = Math.max(0, (now - s.checkedAt) / 1000); // checkedAt = when this snapshot was produced
    const unhealthy = s.status === 'error' || s.status === 'degraded' || s.retained || s.warnings.length > 0;
    return (unhealthy ? Math.min(RETRY_AFTER_S, s.refreshSeconds) : s.refreshSeconds) - age;
  });
  let ttl = remaining.length === 0 ? RETRY_AFTER_S : Math.max(0, Math.floor(Math.min(...remaining)));
  // Never cache past the moment an alert in this response ends, or the CDN would keep showing it as current.
  if (body.next_expiry) ttl = Math.min(ttl, Math.max(0, Math.floor((Date.parse(body.next_expiry) - now) / 1000)));
  // Stale-while-revalidate never outlasts the freshness left, so it cannot stretch an old snapshot.
  return `public, s-maxage=${ttl}, stale-while-revalidate=${Math.min(60, ttl)}`;
}

/** 400 for a request we refuse (with the valid values), 500 for anything unexpected. */
export function errorResponse(err: unknown): Response {
  const headers = { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (err instanceof QueryError) return new Response(JSON.stringify({ ok: false, error: err.message, ...(err.valid ? { valid: err.valid } : {}) }), { status: 400, headers });
  return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers });
}

/** Run the cyber sources and group their reports into incidents (`?min_reports=` keeps corroborated ones). */
export async function runIncidents(params: URLSearchParams, deps: PipelineDeps = {}): Promise<IncidentsResponse> {
  const all = deps.loaders ?? SERVER_LOADERS;
  const q = parseQuery(params, { sources: all.map(l => l.meta.key) });
  const rawMin = params.get('min_reports');
  if (params.has('min_reports') && !/^[1-9]\d{0,2}$/.test(rawMin ?? '')) throw new QueryError(`Invalid "min_reports" "${rawMin ?? ''}": use a whole number from 1 to 999`);
  const selected = q.sources ? all.filter(l => q.sources!.includes(l.meta.key)) : all.filter(l => l.meta.domain === 'cyber');
  const results = await runSources(selected, deps.store ?? store, { now: deps.now, timeoutMs: deps.timeoutMs, reuseFresh: true });
  return buildIncidentsResponse(results, q, rawMin ? Number(rawMin) : 1, (deps.now ?? Date.now)());
}

/** Turn a pipeline result into an HTTP response (503 + no-store when nothing could be served). */
export function toResponse(body: EventsResponse | IncidentsResponse): Response {
  return new Response(JSON.stringify(body), {
    status: body.ok ? 200 : 503,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl(body),
      'X-VigilMap-Version': body.version,
      'X-VigilMap-Count': String(body.count),
    },
  });
}
