import type { VigilEvent } from '../types';

/**
 * What a normalizer returns: the events plus any partial-failure notes ("BBC feed unavailable").
 * A normalizer THROWS when the raw input is unusable as a whole (nothing could be read).
 */
export interface NormalizeResult {
  events: VigilEvent[];
  warnings: string[];
  /**
   * For sources built from several upstream feeds: each feed's own events and whether it answered.
   * The engine keeps a failed feed's previous events, so one feed going down never shrinks the
   * dataset. `events` must be the concatenation of the parts that did answer.
   */
  parts?: Part[];
}

export interface Part {
  name: string;
  ok: boolean;
  events: VigilEvent[];
}

/** Items from a parsed RSS fetch, as produced by shared/rss.ts `fetchFeeds`. */
export interface NewsInput {
  items?: Array<{ title: string; link: string; date: string; description: string; feed: string }>;
  feeds?: Array<{ name: string; ok: boolean }>;
}

export function feedWarnings(feeds: NewsInput['feeds']): string[] {
  const failed = (feeds ?? []).filter(f => !f.ok).map(f => f.name);
  return failed.length > 0 ? [`${failed.join(', ')} feed unavailable`] : [];
}

/** Split a news source's events into one part per RSS feed (events carry the feed name as `source`). */
export function feedParts(events: VigilEvent[], feeds: NewsInput['feeds']): Part[] | undefined {
  if (!feeds || feeds.length === 0) return undefined;
  return feeds.map(f => ({ name: f.name, ok: f.ok, events: f.ok ? events.filter(e => e.source === f.name) : [] }));
}
