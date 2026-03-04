/**
 * Science Proxy — Vercel Edge Function
 * Proxies NASA DONKI (Solar Flares, Geomagnetic Storms) and NeoWs (Asteroids)
 * server-side to avoid CORS issues and consolidate API key usage.
 */
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const NASA_KEY = process.env.NASA_API_KEY ?? 'DEMO_KEY';

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const TODAY           = toYMD(new Date());
const DATE_7_DAYS_AGO = toYMD(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

export default async function handler(_req: Request): Promise<Response> {
  if (_req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const [flrRes, gstRes, neoRes] = await Promise.allSettled([
    fetch(`https://api.nasa.gov/DONKI/FLR?startDate=${DATE_7_DAYS_AGO}&endDate=${TODAY}&api_key=${NASA_KEY}`),
    fetch(`https://api.nasa.gov/DONKI/GST?startDate=${DATE_7_DAYS_AGO}&endDate=${TODAY}&api_key=${NASA_KEY}`),
    fetch(`https://api.nasa.gov/neo/rest/v1/feed?start_date=${TODAY}&end_date=${TODAY}&api_key=${NASA_KEY}`),
  ]);

  async function safeParse(res: PromiseSettledResult<Response>): Promise<unknown> {
    if (res.status === 'rejected') return null;
    if (!res.value.ok) return null;
    try { return await res.value.json(); } catch { return null; }
  }

  const [flr, gst, neo] = await Promise.all([
    safeParse(flrRes),
    safeParse(gstRes),
    safeParse(neoRes),
  ]);

  return new Response(JSON.stringify({ flr, gst, neo }), {
    status: 200,
    headers: {
      ...CORS,
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
    },
  });
}
