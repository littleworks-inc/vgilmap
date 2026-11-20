/**
 * Turns the events in view into the rows a list shows. Shared by the desktop sidebar and the mobile
 * drawer so the two can't drift apart.
 *
 *  - Filter by whether an event can be plotted: All / On map / No location.
 *  - Collapse the CISA KEV catalogue entries into one group row. There can be dozens, they can never
 *    be plotted, and as separate rows they flood the list. A lone entry stays a normal row.
 */
import type { VigilEvent } from '../types';
import { isMappable } from '../types';

export type ListFilter = 'all' | 'map' | 'nomap';
export type ListRow = { kind: 'event'; ev: VigilEvent } | { kind: 'kev'; events: VigilEvent[] };

/** An entry from CISA's KEV catalogue (not a news story about an exploited bug). */
export const isKevEntry = (ev: VigilEvent) => ev.category === 'vulnerability' && ev.source === 'CISA KEV';

export interface BuiltList {
  /** Counts of `base`, so the filter buttons can show what each choice would give. */
  counts: { all: number; map: number; nomap: number };
  /** Events after applying the filter (before grouping). */
  filtered: VigilEvent[];
  rows: ListRow[];
}

export function buildListRows(base: VigilEvent[], filter: ListFilter, maxEvents?: number): BuiltList {
  const onMap = base.filter(isMappable).length;
  const counts = { all: base.length, map: onMap, nomap: base.length - onMap };

  const filtered = filter === 'map' ? base.filter(isMappable)
    : filter === 'nomap' ? base.filter(ev => !isMappable(ev))
    : base;

  const rows: ListRow[] = [];
  let group: Extract<ListRow, { kind: 'kev' }> | null = null;
  for (const ev of maxEvents != null ? filtered.slice(0, maxEvents) : filtered) {
    if (isKevEntry(ev)) {
      if (!group) { group = { kind: 'kev', events: [] }; rows.push(group); }
      group.events.push(ev);
    } else {
      rows.push({ kind: 'event', ev });
    }
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind === 'kev' && r.events.length === 1) rows[i] = { kind: 'event', ev: r.events[0] };
  }
  return { counts, filtered, rows };
}
