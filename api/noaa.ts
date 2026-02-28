export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  try {
    const incoming = new URL(req.url);
    // Extract everything after /api/noaa and forward to NWS
    const after = incoming.pathname.replace(/^\/api\/noaa\/?/, '');
    const nwsPath = after ? `/${after}` : '/alerts/active';
    const nwsUrl  = `https://api.weather.gov${nwsPath}${incoming.search}`;

    const nwsRes = await fetch(nwsUrl, {
      headers: {
        'User-Agent': '(VigilMap, contact@vigilmap.app)',
        'Accept':     'application/geo+json',
      },
    });

    const body = await nwsRes.arrayBuffer();

    return new Response(body, {
      status: nwsRes.status,
      headers: {
        'Content-Type': nwsRes.headers.get('Content-Type') ?? 'application/geo+json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'NOAA proxy error', detail: String(err) }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
