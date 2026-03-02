/**
 * GDELT Economic Proxy — Vercel Edge Function
 * Queries GDELT Doc API filtered for economic/labor keywords.
 */
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const GDELT_URL =
  'https://api.gdeltproject.org/api/v2/doc/doc' +
  '?query=economic+crisis+OR+financial+crisis+OR+inflation+OR+strike+workers+OR+sanctions+OR+unemployment' +
  '&mode=artlist&maxrecords=50&format=json&timespan=24h&sort=DateDesc';

export default async function handler(_req: Request): Promise<Response> {
  if (_req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 7000);

    const res = await fetch(GDELT_URL, {
      headers: { 'User-Agent': 'VigilMap/1.0 (contact@vigilmap.app)' },
      signal: controller.signal,
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ articles: [] }),
        { status: 200, headers: CORS }
      );
    }

    const json = await res.json();
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: {
        ...CORS,
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ articles: [], error: String(err) }),
      { status: 200, headers: CORS }
    );
  }
}
