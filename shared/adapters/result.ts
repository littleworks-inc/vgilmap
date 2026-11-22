import type { VigilEvent } from '../types';

/**
 * What a normalizer returns: the events plus any partial-failure notes ("BBC feed unavailable").
 * A normalizer THROWS when the raw input is unusable as a whole (nothing could be read).
 */
export interface NormalizeResult {
  events: VigilEvent[];
  warnings: string[];
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
