/**
 * GDELT Conflict Proxy — Vercel Edge Function
 * Runs server-side so no CORS issues.
 * Tries Doc API first, falls back to different timespan on retry.
 */
export const config = { runtime: 'edge' };
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};
const BASE =
  'https://api.gdeltproject.org/api/v2/doc/doc' +
  '?query=(conflict+OR+killed+OR+airstrike+OR+bombing+OR+protest' +
  '+OR+clashes+OR+troops+OR+offensive+OR+ceasefire' +
  '+OR+casualties+OR+shelling+OR+insurgency+OR+coup)' +
  '+sourcelang:english' +
  '&mode=artlist' +
  '&maxrecords=50' +
  '&format=json';
const ATTEMPTS = [
  BASE + '&timespan=4h',   // last 4 hours — smallest, fastest
  BASE + '&timespan=12h',  // last 12 hours — wider net
  BASE + '&timespan=1d',   // last day — last resort
];
async function tryFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
export default async function handler(_req: Request): Promise<Response> {
  if (_req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  let lastError = '';
  for (const url of ATTEMPTS) {
    try {
      const res = await tryFetch(url);
      if (!res.ok) {
        lastError = `GDELT ${res.status}`;
        continue; // try next timespan
      }
      const text = await res.text();
      if (!text || !text.trimStart().startsWith('{')) {
        lastError = 'Empty or non-JSON response';
        continue;
      }
      // Success — return with CDN cache
      return new Response(text, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Cache-Control': 'public, s-maxage=180, stale-while-revalidate=60',
        },
      });
    } catch (err) {
      lastError = String(err);
      // Small delay between retries
      await new Promise(r => setTimeout(r, 500));
    }
  }
  // All attempts failed — return empty articles so adapter degrades gracefully
  return new Response(
    JSON.stringify({ articles: [], _error: lastError }),
    {
      status: 200, // return 200 so adapter doesn't throw
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'no-store',
      },
    }
  );
}
