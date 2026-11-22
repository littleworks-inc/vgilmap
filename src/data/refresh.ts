/**
 * How one source's health changes after a refresh attempt. Pure, so the rules that matter are
 * testable: what a failed refresh keeps, which timestamps are trusted, and how truncation is shown.
 */
import type { SourceHealth } from '../health/sourceHealth';
import type { SourceFetch } from './pipeline';

export type RefreshOutcome =
  | { ok: true; fetched: SourceFetch }
  /** The pipeline could not be reached or served nothing; `keptCount` events from an earlier load stay on screen. */
  | { ok: false; error: string; keptCount: number };

export function applyOutcome(
  prev: SourceHealth,
  outcome: RefreshOutcome,
  timing: { durationMs: number; checkedAt: number },
): SourceHealth {
  let patch: Partial<SourceHealth>;
  if (outcome.ok) {
    const { status, truncated } = outcome.fetched;
    // The server owns "when did this data come in" (dataAt / lastOkAt). Data it is serving from its
    // last good copy keeps its ORIGINAL time; `checkedAt` is the only "just now".
    // `error` is cleared explicitly: a healthy status omits the key, and the previous message must not linger.
    patch = { ...status, retained: status.retained ?? false, error: status.error };
    if (truncated) {
      patch.warnings = [...status.warnings, `Showing ${truncated.loaded.toLocaleString()} of ${truncated.total.toLocaleString()} events; the rest were not loaded`];
      if (patch.status === 'ok') patch.status = 'degraded';
    }
  } else {
    patch = {
      status: 'error', count: outcome.keptCount, warnings: [], retained: outcome.keptCount > 0, error: outcome.error,
    };
  }
  return {
    ...prev, ...patch, ...timing,
    // A failure carries no timestamps of its own: keep what we already knew about the data we are showing.
    lastOkAt: patch.lastOkAt ?? prev.lastOkAt,
    dataAt: patch.dataAt ?? prev.dataAt,
    // Likewise newest-event time for retained data.
    newestAt: 'newestAt' in patch ? patch.newestAt : prev.newestAt,
  };
}
