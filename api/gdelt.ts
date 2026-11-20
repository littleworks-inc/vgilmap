/**
 * GDELT Conflict Proxy — Vercel Edge Function.
 * Narrow window first (12h), wider (1d) if that finds nothing. All the hard parts — slow
 * responses, the 1-request-per-5s limit, stale fallback, caching — live in _lib/gdelt.ts.
 */
import { serveGdelt, gdeltCors } from './_lib/gdelt';

export const config = { runtime: 'edge' };

const BASE =
  'query=(conflict+OR+killed+OR+airstrike+OR+bombing+OR+protest' +
  '+OR+clashes+OR+troops+OR+offensive+OR+ceasefire' +
  '+OR+casualties+OR+shelling+OR+insurgency+OR+coup)' +
  '+sourcelang:english' +
  '&mode=artlist&maxrecords=50&format=json&sort=DateDesc';

// (GDELT answers `{}` for the old 4h window far too often, so it starts at 12h.)
const QUERIES = [`${BASE}&timespan=12h`, `${BASE}&timespan=1d`];

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: gdeltCors });
  return serveGdelt('conflict', QUERIES);
}
