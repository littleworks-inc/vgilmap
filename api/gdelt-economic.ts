/**
 * GDELT Economic Proxy — Vercel Edge Function.
 * Economic / labor news. Shared GDELT handling (timeouts, rate limit, stale fallback,
 * caching) lives in _lib/gdelt.ts.
 *
 * NOTE: GDELT requires OR'd terms to be wrapped in parentheses and multi-word phrases quoted.
 * The previous version of this query omitted the parentheses, so GDELT rejected it every time
 * ("Queries containing OR'd terms must be surrounded by ()") and this layer was always empty.
 */
import { serveGdelt, gdeltCors } from './_lib/gdelt';

export const config = { runtime: 'edge' };

const BASE =
  'query=(%22economic+crisis%22+OR+%22financial+crisis%22+OR+inflation' +
  '+OR+strike+OR+sanctions+OR+unemployment)' +
  '+sourcelang:english' +
  '&mode=artlist&maxrecords=50&format=json&sort=DateDesc';

const QUERIES = [`${BASE}&timespan=24h`, `${BASE}&timespan=3d`];

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: gdeltCors });
  return serveGdelt('economic', QUERIES);
}
