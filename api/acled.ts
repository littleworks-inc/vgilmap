export const config = { runtime: 'edge' };

const ACLED_PATH =
  '/acled/read.php' +
  '?terms=accept' +
  '&limit=50' +
  '&fields=data_id,event_date,event_type,sub_event_type,actor1,' +
  'country,admin1,location,latitude,longitude,fatalities,notes,source,timestamp' +
  '&format=json';

export default async function handler(_req: Request): Promise<Response> {
  try {
    const acledRes = await fetch(`https://api.acleddata.com${ACLED_PATH}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': '(VigilMap, contact@vigilmap.app)',
      },
    });
    const body = await acledRes.arrayBuffer();
    return new Response(body, {
      status: acledRes.status,
      headers: {
        'Content-Type': acledRes.headers.get('Content-Type') ?? 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'ACLED proxy error', detail: String(err) }),
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
