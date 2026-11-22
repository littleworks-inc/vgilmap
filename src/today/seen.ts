/**
 * What THIS BROWSER last saw on the Today screen, so a returning visit can say what is new.
 *
 * This is local and approximate on purpose: it compares against a snapshot saved when the screen was
 * last open. It is not stored incident history (that needs server-side identity), and it cannot see
 * changes that happened between two visits to anything other than the report count and evidence kinds.
 */
import type { EvidenceKind } from '../types';

export interface SeenItem { n: number; evidence: EvidenceKind[] }
export interface SeenSnapshot {
  at: number;
  items: Record<string, SeenItem>;
  /**
   * The snapshot was cut at MAX_ITEMS, keeping the most important items. An item missing from a PARTIAL
   * snapshot may simply not have fit, so absence alone must not be reported as "new".
   */
  partial?: boolean;
}

export const SEEN_KEY = 'vigil.seen.v1';
/** Compact (about 50 bytes an item), so this is a few hundred KB at most. */
export const MAX_ITEMS = 5000;

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } // blocked storage can throw on access
}

/** The saved snapshot, or null when there is none, it is unreadable, or storage is unavailable. */
export function loadSeen(storage: StorageLike | null = defaultStorage()): SeenSnapshot | null {
  try {
    const raw = storage?.getItem(SEEN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SeenSnapshot>;
    if (typeof v.at !== 'number' || !v.items || typeof v.items !== 'object') return null;
    const items: Record<string, SeenItem> = {};
    for (const [id, it] of Object.entries(v.items)) {
      if (it && typeof it.n === 'number' && Array.isArray(it.evidence)) items[id] = { n: it.n, evidence: it.evidence };
    }
    return { at: v.at, items, ...(v.partial ? { partial: true } : {}) };
  } catch {
    return null;
  }
}

/** Save what is on screen now. Never throws: remembering is a convenience, not a requirement. */
export function saveSeen(items: Record<string, SeenItem>, now: number, storage: StorageLike | null = defaultStorage()): void {
  try {
    // `items` arrives most-important-first, so a cut drops the least important ones.
    const all = Object.keys(items);
    const ids = all.slice(0, MAX_ITEMS);
    storage?.setItem(SEEN_KEY, JSON.stringify({
      at: now, items: Object.fromEntries(ids.map(id => [id, items[id]])), ...(all.length > MAX_ITEMS ? { partial: true } : {}),
    }));
  } catch { /* quota or blocked storage: carry on */ }
}
