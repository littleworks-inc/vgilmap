/**
 * Minimal RSS / RDF feed fetching + parsing for the edge proxies.
 *
 * Handles what the real feeds do: <item> with attributes (DW's RDF feeds use
 * `<item rdf:about="…">`, which a plain `<item>` pattern silently skips), CDATA, XML entities,
 * and the date living in <pubDate>, <dc:date>, <published> or <updated>.
 */
export interface FeedItem {
  title: string;
  link: string;
  date: string;        // ISO 8601
  description: string; // plain text, ≤ 300 chars
  feed: string;        // human-readable feed name
}

export interface FeedResult {
  name: string;
  ok: boolean;
  items: FeedItem[];
  error?: string;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

function tagText(chunk: string, name: string): string {
  const esc = name.replace(':', '\\:');
  const re = new RegExp(`<${esc}\\b[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${esc}>`, 'i');
  const m = chunk.match(re);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

function plain(html: string): string {
  return decodeEntities(decodeEntities(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function parseFeed(xml: string, feed: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const chunk = m[1];
    const title = plain(tagText(chunk, 'title'));
    if (!title) continue;
    const rawDate = tagText(chunk, 'pubDate') || tagText(chunk, 'dc:date') || tagText(chunk, 'published') || tagText(chunk, 'updated');
    const when = new Date(rawDate);
    if (Number.isNaN(when.getTime())) continue; // no usable date → can't place it in time
    items.push({
      title,
      link: decodeEntities(tagText(chunk, 'link')) || '',
      date: when.toISOString(),
      description: plain(tagText(chunk, 'description')).slice(0, 300),
      feed,
    });
  }
  return items;
}

export async function fetchFeed(name: string, url: string, timeoutMs = 6_000): Promise<FeedResult> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VigilMap/1.0; +https://github.com/littleworks-inc/vgilmap)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!res.ok) return { name, ok: false, items: [], error: `HTTP ${res.status}` };
    const items = parseFeed(await res.text(), name);
    return items.length > 0 ? { name, ok: true, items } : { name, ok: false, items: [], error: 'no items' };
  } catch (err) {
    return { name, ok: false, items: [], error: err instanceof Error ? err.name : 'error' };
  }
}

/** Fetch several feeds in parallel, keep items matching `keep`, newest first. */
export async function fetchFeeds(
  feeds: Array<{ name: string; url: string }>,
  keep: RegExp,
  limit: number,
): Promise<{ items: FeedItem[]; feeds: Array<{ name: string; ok: boolean; count: number; error?: string }> }> {
  const results = await Promise.all(feeds.map(f => fetchFeed(f.name, f.url)));
  // The same story shows up in several feeds (and sometimes twice in one), so de-duplicate by title.
  const seen = new Set<string>();
  const items = results
    .flatMap(r => r.items)
    .filter(i => keep.test(i.title) || keep.test(i.description))
    .filter(i => { const k = i.title.toLowerCase().replace(/\W+/g, ' ').trim(); return seen.has(k) ? false : (seen.add(k), true); })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
  return {
    items,
    feeds: results.map(r => ({ name: r.name, ok: r.ok, count: r.items.length, ...(r.error ? { error: r.error } : {}) })),
  };
}
