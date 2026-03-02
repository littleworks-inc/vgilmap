/**
 * ReliefWeb Proxy — Vercel Edge Function
 * Fetches humanitarian crisis reports from UN OCHA ReliefWeb API.
 */
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const RW_API = 'https://api.reliefweb.int/v1/reports';

const QUERY_BODY = JSON.stringify({
  preset: 'latest',
  limit: 50,
  fields: {
    include: [
      'title', 'date', 'country', 'primary_country',
      'source', 'url', 'body', 'theme',
    ],
  },
  sort: ['date.created:desc'],
});

export default async function handler(_req: Request): Promise<Response> {
  if (_req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);

    const res = await fetch(RW_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'VigilMap/1.0 (contact@vigilmap.app)',
        'Accept': 'application/json',
      },
      body: QUERY_BODY,
      signal: controller.signal,
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ data: [], error: `ReliefWeb ${res.status}` }),
        { status: 200, headers: CORS }
      );
    }

    const json = await res.json();
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: {
        ...CORS,
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=120',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ data: [], error: String(err) }),
      { status: 200, headers: CORS }
    );
  }
}
