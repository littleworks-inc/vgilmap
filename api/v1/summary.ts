/**
 * VigilMap Public REST API — /api/v1/summary
 *
 * Returns event counts by domain and severity.
 * Useful for dashboards, status widgets, and health checks.
 */
export const config = { runtime: 'edge' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  try {
    // Fetch from our own events endpoint
    const base = new URL(req.url);
    const eventsUrl = `${base.origin}/api/v1/events?limit=100`;
    const res = await fetch(eventsUrl);
    if (!res.ok) throw new Error(`events fetch failed: ${res.status}`);
    const json = await res.json();
    const events: any[] = json.data ?? [];
    const byDomain: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const e of events) {
      byDomain[e.domain] = (byDomain[e.domain] ?? 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    }
    const topEvents = events
      .filter(e => e.severity === 'critical' || e.severity === 'high')
      .slice(0, 5)
      .map(e => ({ id: e.id, title: e.title, severity: e.severity, domain: e.domain, location: e.location.label }));
    return new Response(
      JSON.stringify({
        ok: true,
        generated: new Date().toISOString(),
        total_events: events.length,
        by_domain: byDomain,
        by_severity: bySeverity,
        top_events: topEvents,
      }),
      {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
}
