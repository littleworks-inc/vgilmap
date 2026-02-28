export const config = { runtime: 'edge' };

const GDELT_HEALTH_URL =
  'https://api.gdeltproject.org/api/v2/doc/doc' +
  '?query=(cholera+OR+ebola+OR+mpox+OR+dengue+OR+measles' +
  '+OR+"bird+flu"+OR+outbreak+OR+epidemic+OR+marburg' +
  '+OR+lassa+OR+typhoid+OR+monkeypox+OR+polio)' +
  '+sourcelang:english' +
  '&mode=artlist' +
  '&maxrecords=30' +
  '&format=json' +
  '&timespan=3d';

export default async function handler(_req: Request): Promise<Response> {
  try {
    const res = await fetch(GDELT_HEALTH_URL, {
      headers: { 'Accept': 'application/json' },
    });
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
