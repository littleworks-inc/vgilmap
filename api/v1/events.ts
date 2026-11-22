/**
 * VigilMap Public REST API — /api/v1/events
 *
 * The same normalized dataset the app uses (13 sources), through one pipeline.
 *
 * GET /api/v1/events
 *   ?domain=disaster,climate,health,conflict,economic,labor,science,cyber
 *   ?source=usgs-day,noaa,...       (source keys; default: every source except the optional GDELT extra,
 *                                    which is slow and flaky. Name it, or pass ?optional=1, to include it)
 *   ?severity=low|medium|high|critical   (minimum)
 *   ?since=2026-01-01T00:00:00Z
 *   ?location=map|nomap             (events with / without a place on the map)
 *   ?limit=100&cursor=...           (limit max 1000; pass next_cursor to get the next page)
 *
 * `total` and `summary` describe everything that matches the filters, before pagination. Pages are
 * keyset cursors over a stable order, so new events arriving between requests cannot repeat or skip
 * any. Unsupported filter values are rejected with 400 and the list of valid values.
 * `sources` reports each source's health, retained-stale state, coverage and location precision.
 */
import { CORS, errorResponse, runPipeline, toResponse } from '../_lib/pipeline';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    const { body } = await runPipeline(new URL(req.url).searchParams);
    return toResponse(body);
  } catch (err) {
    return errorResponse(err);
  }
}
