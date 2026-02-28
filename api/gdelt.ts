export const config = { runtime: 'edge' };

const GDELT_CONFLICT_URL =
  'https://api.gdeltproject.org/api/v2/doc/doc' +
  '?query=(conflict+OR+killed+OR+airstrike+OR+bombing+OR+protest' +
  '+OR+clashes+OR+troops+OR+militia+OR+offensive+OR+ceasefire' +
  '+OR+casualties+OR+shelling+OR+insurgency+OR+coup)' +
  '+sourcelang:english' +
  '&mode=artlist' +
  '&maxrecords=50' +
  '&format=json' +
  '&timespan=2d';

export default async function handler(_req: Request): Promise<Response> {
  try {
    const res = await fetch(GDELT_CONFLICT_URL, {
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
