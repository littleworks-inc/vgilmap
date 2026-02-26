export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Vercel rewrites capture path segments as a ?path= query parameter.
  // e.g. /api/noaa/alerts/active → /api/noaa?path=alerts/active
  // We reconstruct the NWS path from whichever form we receive.
  let nwsPath: string;
  const pathParam = url.searchParams.get('path');

  if (pathParam) {
    // Strip 'path' from the query string, keep any other params
    const remaining = new URLSearchParams(url.search);
    remaining.delete('path');
    const qs = remaining.toString();
    nwsPath = `/${pathParam}${qs ? `?${qs}` : ''}`;
  } else {
    // Direct path (Vite dev proxy passes the full pathname)
    nwsPath = url.pathname.replace(/^\/api\/noaa/, '') + url.search;
  }

  const nwsUrl = `https://api.weather.gov${nwsPath}`;

  const nwsResponse = await fetch(nwsUrl, {
    headers: {
      // NWS requires a User-Agent or returns 403
      'User-Agent': '(VigilMap, contact@vigilmap.app)',
      'Accept':     'application/geo+json',
    },
  });

  const body = await nwsResponse.arrayBuffer();

  return new Response(body, {
    status: nwsResponse.status,
    headers: {
      'Content-Type':
        nwsResponse.headers.get('Content-Type') ?? 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
