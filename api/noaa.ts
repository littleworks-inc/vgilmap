export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Strip the /api/noaa prefix and forward the rest to api.weather.gov
  const nwsPath = url.pathname.replace(/^\/api\/noaa/, '') + url.search;
  const nwsUrl  = `https://api.weather.gov${nwsPath}`;

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
