/**
 * Economic & labor news RSS proxy — Vercel Edge Function.
 *
 * Replaces the GDELT-based economic feed, which GDELT's rate limiting made unavailable most of the
 * time. These feeds answer in well under a second.
 */
import { fetchFeeds } from './_lib/rss';

export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

const FEEDS = [
  { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { name: 'DW Business', url: 'https://rss.dw.com/rdf/rss-en-bus' },
  { name: 'Guardian Economics', url: 'https://www.theguardian.com/business/economics/rss' },
  { name: 'Guardian Global Development', url: 'https://www.theguardian.com/global-development/rss' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'NPR Business', url: 'https://feeds.npr.org/1006/rss.xml' },
];

// Crisis / labor signal, not general business news. "union" alone would match "European Union", and
// a bare "strike" would match military strikes ("Ukraine strikes bridge"), so strikes need labor context.
const ECON =
  /inflation|recession|economic crisis|financial crisis|debt crisis|sovereign debt|\bdefault(s|ed)?\b|sanction|unemployment|layoff|lay-off|job cuts|redundanc|on strike|general strike|strike action|strike ballot|\bstrikers?\b|walkout|(?:workers|staff|nurses|teachers|doctors|drivers|pilots|miners|dockers|unions?|rail|port|airline)\s+(?:\w+\s+)?strikes?\b|strikes?\s+(?:over|by workers|by staff)|industrial action|trade union|labou?r union|\bunions\b|\bwages?\b|bankrupt|currency crisis|devalu|bailout|austerity|tariff|shortage|food price|cost of living|poverty|famine|bank run|economic collapse|supply chain/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { items, feeds } = await fetchFeeds(FEEDS, ECON, 60);
  if (feeds.every(f => !f.ok)) {
    return new Response(JSON.stringify({ items: [], feeds, error: 'all economic RSS feeds failed' }), {
      status: 502,
      headers: { ...CORS, 'Cache-Control': 'no-store' },
    });
  }
  return new Response(JSON.stringify({ items, feeds }), {
    status: 200,
    headers: { ...CORS, 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=600' },
  });
}
