/**
 * The app's only data entry point: one source of the shared pipeline (/api/v1/events).
 * Normalization, filtering rules and health classification all happen on the server, so the map
 * shows exactly what the public API serves.
 */
import type { VigilEvent } from '../types';
import type { SourceStatus } from '../../shared/pipeline/engine';
import type { EventsResponse } from '../../shared/pipeline/query';

const PAGE = 1000;
const MAX_PAGES = 20; // 20,000 events per source: far above anything a source returns today

export interface SourceFetch {
  events: VigilEvent[];
  status: SourceStatus;
  /** Set when the source has more events than we were willing to load, so the UI can say so. */
  truncated: { loaded: number; total: number } | null;
}

/**
 * Fetch every event of one source. Throws when the pipeline could serve nothing for it (the
 * caller keeps showing its own last copy); a source the server is serving from ITS last good
 * copy comes back normally with `status.retained` set. Pages follow the server's cursor, which
 * is stable while new events arrive, and any events we stop short of are reported, never dropped
 * silently.
 */
export async function fetchSource(key: string): Promise<SourceFetch> {
  const events: VigilEvent[] = [];
  let status: SourceStatus | undefined;
  let cursor: string | null = null;
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res: Response = await fetch(`/api/v1/events?source=${encodeURIComponent(key)}&limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    let body: EventsResponse | undefined;
    try { body = (await res.json()) as EventsResponse; } catch { /* not JSON */ }
    const s = body?.sources?.[0];
    if (!res.ok || !body || !s) throw new Error(s?.error ?? (body as { error?: string } | undefined)?.error ?? `pipeline ${res.status}`);
    status = s;
    total = body.total;
    events.push(...body.data);
    cursor = body.next_cursor;
    if (cursor === null) break;
  }
  return { events, status: status!, truncated: cursor !== null ? { loaded: events.length, total } : null };
}
