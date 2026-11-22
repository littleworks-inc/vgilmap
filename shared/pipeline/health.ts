/**
 * Data-source health model (pure, shared by the server pipeline and the app).
 *
 * Why this exists: most "problems" with the data were invisible. A source that is down, a
 * source that is up but returning nothing, and a source returning only years-old items all
 * look the same on the map: nothing. This classifies each source so the UI can say which.
 */
import type { VigilEvent } from '../types';

export type HealthStatus =
  | 'loading'   // first fetch still in flight
  | 'ok'        // returned recent events
  | 'degraded'  // returned events, but a part of the source failed (see warnings)
  | 'stale'     // returned events, but the newest is older than this source should produce
  | 'empty'     // request succeeded but returned no events
  | 'error';    // request failed

/** Classify a successful fetch. */
export function classify(
  events: VigilEvent[],
  staleAfterHours: number,
  warnings: string[],
  now: number,
): { status: HealthStatus; newestAt?: string } {
  if (events.length === 0) return { status: 'empty' };

  let newest = 0;
  for (const ev of events) {
    const t = new Date(ev.timestamp).getTime();
    if (!Number.isNaN(t) && t > newest) newest = t;
  }
  const newestAt = newest > 0 ? new Date(newest).toISOString() : undefined;
  if (newest > 0 && now - newest > staleAfterHours * 3_600_000) return { status: 'stale', newestAt };
  return { status: warnings.length > 0 ? 'degraded' : 'ok', newestAt };
}

/** "3m ago", "2h ago": how long ago something happened, given the elapsed milliseconds. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
