/**
 * The app's only data entry point: one source of the shared pipeline (/api/v1/events).
 * Normalization, filtering rules and health classification all happen on the server, so the map
 * shows exactly what the public API serves.
 */
import type { VigilEvent } from '../types';
import type { SourceStatus } from '../../shared/pipeline/engine';
import type { EventsResponse } from '../../shared/pipeline/query';

const PAGE = 1000;
const MAX_PAGES = 5;

export interface SourceFetch { events: VigilEvent[]; status: SourceStatus }

/**
 * Fetch every event of one source. Throws when the pipeline could serve nothing for it (the
 * caller keeps showing its own last copy); a source the server is serving from ITS last good
 * copy comes back normally with `status.retained` set.
 */
export async function fetchSource(key: string): Promise<SourceFetch> {
  const events: VigilEvent[] = [];
  let status: SourceStatus | undefined;
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`/api/v1/events?source=${encodeURIComponent(key)}&limit=${PAGE}&offset=${offset}`);
    let body: EventsResponse | undefined;
    try { body = (await res.json()) as EventsResponse; } catch { /* not JSON */ }
    const s = body?.sources?.[0];
    if (!res.ok || !body || !s) throw new Error(s?.error ?? `pipeline ${res.status}`);
    status = s;
    events.push(...body.data);
    if (body.next_offset === null) break;
    offset = body.next_offset;
  }
  return { events, status: status! };
}
