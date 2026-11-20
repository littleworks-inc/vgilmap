/**
 * Conflict news RSS proxy — Vercel Edge Function.
 * BBC World, DW World and Al Jazeera, filtered to conflict-related headlines.
 *
 * (The previous Guardian "conflicts" feed now returns 404, and the DW feed was never parsed —
 * its items are `<item rdf:about=…>`. Both fixed; see _lib/rss.ts.)
 *
 * Reports per-feed status so the app can show a partial failure; returns 502 only if every feed
 * failed.
 */
import { fetchFeeds } from './_lib/rss';

export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

const FEEDS = [
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'DW World', url: 'https://rss.dw.com/rdf/rss-en-world' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
];

const CONFLICT =
  /\bwar\b|conflict|attack|killed|airstrike|air strike|bombing|bombed|troops|clashes|ceasefire|offensive|militia|insurgen|coup|rebel|unrest|hostage|siege|shelling|missile|drone strike|massacre/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { items, feeds } = await fetchFeeds(FEEDS, CONFLICT, 50);
  if (feeds.every(f => !f.ok)) {
    return new Response(JSON.stringify({ items: [], feeds, error: 'all conflict RSS feeds failed' }), {
      status: 502,
      headers: { ...CORS, 'Cache-Control': 'no-store' },
    });
  }
  return new Response(JSON.stringify({ items, feeds }), {
    status: 200,
    headers: { ...CORS, 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=300' },
  });
}
