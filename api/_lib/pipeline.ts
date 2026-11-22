/**
 * The pipeline entry used by every public endpoint: pick sources, run them with last-good
 * retention, and build the one response shape.
 *
 * Last-good data is kept in memory per function instance. That survives a flaky upstream within
 * an instance's lifetime; the CDN cache (s-maxage) and the app's own retained copy cover the rest.
 */
import { MemoryStore, runSources } from '../../shared/pipeline/engine';
import type { LastGoodStore, SourceLoader, SourceResult } from '../../shared/pipeline/engine';
import { buildEventsResponse, parseQuery } from '../../shared/pipeline/query';
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
  const q = parseQuery(params);
  const all = deps.loaders ?? SERVER_LOADERS;
  const selected = q.sources ? all.filter(l => q.sources!.includes(l.meta.key))
    : params.get('optional') === '1' ? all : all.filter(l => !l.meta.optional);
  const results = await runSources(selected, deps.store ?? store, { now: deps.now, timeoutMs: deps.timeoutMs });
  return { body: buildEventsResponse(results, q, (deps.now ?? Date.now)()), results };
}

/**
 * Edge caching follows the fastest-refreshing selected source. Anything degraded is cached only
 * briefly so recovery shows up quickly, and a response with no data at all is never cached.
 */
export function cacheControl(body: EventsResponse): string {
  if (!body.ok) return 'no-store';
  const degraded = body.sources.some(s => s.status === 'error' || s.status === 'degraded');
  const ttl = degraded ? 30 : Math.min(...body.sources.map(s => s.refreshSeconds), 300);
  return `public, s-maxage=${ttl}, stale-while-revalidate=60`;
}

/** Turn a pipeline result into an HTTP response (503 + no-store when nothing could be served). */
export function toResponse(body: EventsResponse): Response {
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
