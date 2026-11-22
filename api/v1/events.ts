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
 *   ?limit=100&offset=0             (limit max 1000; see next_offset)
 *
 * `total` and `summary` describe everything that matches the filters, before pagination.
 * `sources` reports each source's health, retained-stale state, coverage and location precision.
 */
import { CORS, runPipeline, toResponse } from '../_lib/pipeline';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    const { body } = await runPipeline(new URL(req.url).searchParams);
    return toResponse(body);
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
