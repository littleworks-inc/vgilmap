/**
 * Conflict RSS Proxy — Vercel Edge Function
 * Fetches BBC World / Al Jazeera conflict RSS server-side.
 * Returns normalised { items: RSSItem[] } JSON.
 */
export const config = { runtime: 'edge' };
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>` +
    `|<${tag}[^>]*>([^<]*)<\\/${tag}>`,
    'i'
  );
  const m = xml.match(re);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}
function parseRSS(xml: string) {
  const items: Array<{ title: string; link: string; pubDate: string; description: string }> = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const chunk = m[1];
    items.push({
      title:       extractTag(chunk, 'title'),
      link:        extractTag(chunk, 'link'),
      pubDate:     extractTag(chunk, 'pubDate'),
      description: extractTag(chunk, 'description').slice(0, 300),
    });
  }
  return items.filter(i => i.title).slice(0, 30);
}
// Multiple RSS sources — try each, merge results
const FEEDS = [
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://rss.dw.com/rdf/rss-en-world',
  'https://www.theguardian.com/world/conflicts/rss',
];
const CONFLICT_KEYWORDS =
  /war|conflict|attack|killed|airstrike|bombing|troops|clashes|ceasefire|offensive|militia|insurgent|coup|rebel|protest|unrest|crisis|hostage|siege/i;
export default async function handler(_req: Request): Promise<Response> {
  if (_req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const allItems: Array<{ title: string; link: string; pubDate: string; description: string; feed: string }> = [];
  await Promise.allSettled(
    FEEDS.map(async (feedUrl) => {
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5000);
        const res = await fetch(feedUrl, {
          headers: {
            'User-Agent': '(VigilMap, contact@vigilmap.app)',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          },
          signal: controller.signal,
        });
        if (!res.ok) return;
        const xml = await res.text();
        const items = parseRSS(xml)
          .filter(item => CONFLICT_KEYWORDS.test(item.title) || CONFLICT_KEYWORDS.test(item.description))
          .map(item => ({ ...item, feed: feedUrl }));
        allItems.push(...items);
      } catch {
        // silent
      }
    })
  );
  return new Response(
    JSON.stringify({ items: allItems.slice(0, 40) }),
    {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    }
  );
}
