/**
 * ProMED RSS Proxy — Disease Outbreak Alerts
 * Fetches ProMED's public RSS feed server-side (bypasses browser CORS).
 * ProMED is operated by the International Society for Infectious Diseases.
 */
export const config = { runtime: 'edge' };

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`,
    'i'
  );
  const m = xml.match(re);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

interface RSSItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

function parseRSS(xml: string): RSSItem[] {
  const items: RSSItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const chunk = m[1];
    items.push({
      title:       extractTag(chunk, 'title'),
      link:        extractTag(chunk, 'link'),
      pubDate:     extractTag(chunk, 'pubDate'),
      description: extractTag(chunk, 'description').slice(0, 400),
    });
  }
  return items.slice(0, 25);
}

export default async function handler(_req: Request): Promise<Response> {
  try {
    const rss = await fetch('https://promedmail.org/feed/', {
      headers: {
        'User-Agent': '(VigilMap, contact@vigilmap.app)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    });

    if (!rss.ok) {
      return new Response(
        JSON.stringify({ error: `ProMED RSS returned ${rss.status}` }),
        {
          status: rss.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        }
      );
    }

    const xml = await rss.text();
    const items = parseRSS(xml);

    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
