/**
 * ReliefWeb proxy — Vercel Edge Function.
 *
 * Serves ReliefWeb's public "Disasters" RSS feed (UN OCHA). ReliefWeb retired its v1 JSON API
 * (HTTP 410) and the v2 API now requires a pre-registered app name, but this RSS feed needs no
 * key. It has no CORS headers, hence the proxy.
 *
 * Failures return a real 5xx (never a 200 with an empty body) so the app's Data Health panel can
 * report the source as down instead of "no data".
 */
export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*' };
const FEED_URL = 'https://reliefweb.int/disasters/rss.xml';

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const res = await fetch(FEED_URL, {
      headers: { 'User-Agent': 'VigilMap/1.0 (https://github.com/littleworks-inc/vgilmap)', Accept: 'application/rss+xml, application/xml' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return fail(`ReliefWeb RSS ${res.status}`);
    const xml = await res.text();
    if (!xml.includes('<item>')) return fail('ReliefWeb RSS had no items');
    return new Response(xml, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
      },
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function fail(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 502,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
