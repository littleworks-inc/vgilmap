/**
 * RSS fetching for the edge loaders. Parsing lives in shared/rss.ts (pure, testable).
 */
import { parseFeed } from '../../shared/rss';
import type { FeedItem, FeedResult } from '../../shared/rss';

export { parseFeed };
export type { FeedItem, FeedResult };

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
