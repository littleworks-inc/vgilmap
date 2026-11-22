/**
 * Minimal RSS / RDF feed parsing (no network, no DOM), shared by the server loaders and normalizers.
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

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

export function tagText(chunk: string, name: string): string {
  const esc = name.replace(':', '\\:');
  const re = new RegExp(`<${esc}\\b[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${esc}>`, 'i');
  const m = chunk.match(re);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

export function plain(html: string): string {
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
