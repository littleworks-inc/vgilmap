/**
 * VigilMap Public REST API — /api/v1/summary
 *
 * Counts by domain, severity and location precision over the FULL filtered dataset (same
 * pipeline and filters as /api/v1/events, but without the page of events), plus per-source health.
 * Accepts the same filters as /api/v1/events (domain, source, severity, since, location).
 */
import { CORS, cacheControl, runPipeline } from '../_lib/pipeline';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    const { body } = await runPipeline(new URL(req.url).searchParams);
    const { summary, sources } = body;
    const payload = {
      ok: body.ok,
      version: body.version,
      generated: body.generated,
      total_events: summary.total,
      total_unfiltered: body.total_unfiltered,
      by_domain: summary.by_domain,
      by_severity: summary.by_severity,
      by_precision: summary.by_precision,
      top_events: summary.top_events,
      sources,
    };
    return new Response(JSON.stringify(payload), {
      status: body.ok ? 200 : 503,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': cacheControl(body) },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
