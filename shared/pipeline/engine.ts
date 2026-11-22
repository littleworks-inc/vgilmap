/**
 * The ingestion engine: runs source loaders, keeps each source's last good result, and reports
 * per-source health. Pure and dependency-injected (loaders, store and clock are passed in), so it
 * runs identically in the Vercel function and in tests.
 */
import type { VigilEvent } from '../types';
import type { NormalizeResult, Part } from '../adapters/result';
import type { SourceMeta } from './sources';
import { ago, classify } from './health';
import type { HealthStatus } from './health';
import { withPrecision } from './precision';

export interface SourceLoader {
  meta: SourceMeta;
  /** Fetch upstream and normalize. Throws when the source is unusable as a whole. */
  load(): Promise<NormalizeResult>;
}

/** Everything the app and the API report about one source after a run. */
export interface SourceStatus {
  key: string;
  label: string;
  domain: SourceMeta['domain'];
  status: HealthStatus;
  count: number;
  newestAt?: string;
  warnings: string[];
  error?: string;
  /** The latest refresh failed; `count` events from the last good run are still being served. */
  retained?: boolean;
  /** When the served events were fetched (epoch ms). For a retained source this is the last good run. */
  dataAt?: number;
  /** Epoch ms of the last run that returned events. */
  lastOkAt?: number;
  /** For multi-feed sources: how each feed contributed (fresh, or retained from an earlier fetch). */
  parts?: PartStatus[];
  durationMs: number;
  checkedAt: number;
  optional?: boolean;
  refreshSeconds: number;
  precision: SourceMeta['precision'];
  coverage: string;
}

export interface PartStatus {
  name: string;
  /** This feed answered in the latest run. */
  ok: boolean;
  /** This feed failed, and its events below are from an earlier fetch. */
  retained?: boolean;
  count: number;
  /** When this feed's events were fetched (epoch ms). */
  dataAt: number;
}

export interface SourceResult {
  status: SourceStatus;
  events: VigilEvent[];
}

/** The last successful run of a source, kept so a failing refresh can fall back to it. */
export interface LastGood {
  events: VigilEvent[];
  /** When these events were fetched. For multi-feed sources, the OLDEST contributing feed's time. */
  at: number;
  /** Last time any events came back fresh (a later run with nothing new does not move it). */
  lastOkAt?: number;
  /** For multi-feed sources: each feed's last good events AND when they were fetched. */
  parts?: Record<string, { events: VigilEvent[]; at: number }>;
}

/** What the engine remembers per source: the last good data and the outcome of the latest run. */
export interface SourceEntry {
  good?: LastGood;
  /** `ok` is false when the run failed OR was only partial (a feed or upstream failed): both are retried sooner. */
  last?: { result: SourceResult; at: number; ok: boolean };
}

export interface LastGoodStore {
  get(key: string): SourceEntry | undefined;
  set(key: string, entry: SourceEntry): void;
  /** Runs in flight, so concurrent requests for one source share a single upstream fetch. */
  inflight: Map<string, Promise<SourceResult>>;
}

export class MemoryStore implements LastGoodStore {
  private m = new Map<string, SourceEntry>();
  inflight = new Map<string, Promise<SourceResult>>();
  get(key: string) { return this.m.get(key); }
  set(key: string, entry: SourceEntry) { this.m.set(key, entry); }
}

export interface RunOptions {
  now?: () => number;
  /** A loader that has not answered by then is treated as failed (edge functions must reply in ~25s). */
  timeoutMs?: number;
  /**
   * Serve the source's latest snapshot, without calling upstream, while it is younger than the
   * source's refresh interval (or, after a failure, for a short back-off). Requests with different
   * filters or pages then all see the same snapshot. Off by default so tests control timing.
   */
  reuseFresh?: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;
/** After a failed run, don't hit a struggling upstream again for this long (capped by the refresh interval). */
const FAILURE_BACKOFF_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

function baseStatus(meta: SourceMeta): Pick<SourceStatus, 'key' | 'label' | 'domain' | 'optional' | 'refreshSeconds' | 'precision' | 'coverage'> {
  return { key: meta.key, label: meta.label, domain: meta.domain, optional: meta.optional, refreshSeconds: meta.refreshSeconds, precision: meta.precision, coverage: meta.coverage };
}

/**
 * Combine a multi-feed result with what we remember, feed by feed. A feed that answered replaces its
 * old events (and takes the current time); a feed that failed keeps its previous events AND the time
 * they were fetched, so retained data never looks fresher than it is.
 */
function mergeParts(parts: Part[], prev: LastGood['parts'], now: number) {
  const kept: NonNullable<LastGood['parts']> = {};
  const notes: string[] = [];
  const status: PartStatus[] = [];
  for (const p of parts) {
    const old = prev?.[p.name];
    if (p.ok) {
      kept[p.name] = { events: p.events, at: now };
      status.push({ name: p.name, ok: true, count: p.events.length, dataAt: now });
    } else if (old) {
      kept[p.name] = old;
      status.push({ name: p.name, ok: false, retained: old.events.length > 0, count: old.events.length, dataAt: old.at });
      if (old.events.length > 0) notes.push(`${p.name}: refresh failed, showing ${old.events.length} events from ${ago(now - old.at)}`);
    } else {
      status.push({ name: p.name, ok: false, count: 0, dataAt: now });
    }
  }
  const contributing = Object.values(kept).filter(k => k.events.length > 0);
  return {
    events: contributing.flatMap(k => k.events), kept, notes, status,
    retained: status.some(s => s.retained),
    // The data is as old as its oldest contributing feed.
    dataAt: contributing.length > 0 ? Math.min(...contributing.map(k => k.at)) : now,
    freshEvents: parts.some(p => p.ok && p.events.length > 0),
  };
}

async function execute(loader: SourceLoader, store: LastGoodStore, opts: RunOptions): Promise<SourceResult> {
  const now = opts.now ?? Date.now;
  const { meta } = loader;
  const startedAt = now();
  const prev = store.get(meta.key);
  try {
    const out = await withTimeout(loader.load(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, meta.label);
    const t = now();
    let raw = out.events;
    let kept: LastGood['parts'];
    let partStatus: PartStatus[] | undefined;
    let retained = false;
    let dataAt = t;
    let freshEvents = out.events.length > 0;
    const warnings = [...out.warnings];
    if (out.parts) {
      const merged = mergeParts(out.parts, prev?.good?.parts, t);
      raw = merged.events; kept = merged.kept; partStatus = merged.status;
      retained = merged.retained; dataAt = merged.dataAt; freshEvents = merged.freshEvents;
      warnings.push(...merged.notes);
    }
    const events = raw.map(e => withPrecision(e, meta.precision));
    const { status, newestAt } = classify(events, meta.staleAfterHours, warnings, t);
    // "Last had data" only moves when something came back fresh; retained events keep their own time.
    const lastOkAt = freshEvents ? t : prev?.good?.lastOkAt ?? (prev?.good?.events.length ? prev.good.at : undefined);
    // A partial run (a feed or upstream failed) is retried on the failure back-off, not held for the full interval.
    const partial = out.warnings.length > 0 || !!out.parts?.some(p => !p.ok);
    const result: SourceResult = {
      events,
      status: {
        ...baseStatus(meta), status, count: events.length, newestAt, warnings,
        ...(retained ? { retained: true } : {}),
        ...(partStatus ? { parts: partStatus } : {}),
        dataAt, lastOkAt, durationMs: t - startedAt, checkedAt: t,
      },
    };
    store.set(meta.key, { good: { events, at: dataAt, lastOkAt, parts: kept }, last: { result, at: t, ok: !partial } });
    return result;
  } catch (reason) {
    const t = now();
    const error = reason instanceof Error ? reason.message : String(reason);
    const kept = prev?.good;
    const retained = !!kept && kept.events.length > 0;
    const result: SourceResult = {
      events: retained ? kept.events : [],
      status: {
        ...baseStatus(meta), status: 'error', count: retained ? kept.events.length : 0,
        newestAt: retained ? classify(kept.events, meta.staleAfterHours, [], t).newestAt : undefined,
        warnings: [], error, retained: retained || undefined,
        dataAt: retained ? kept.at : undefined, lastOkAt: retained ? (kept.lastOkAt ?? kept.at) : undefined,
        ...(retained && kept.parts ? { parts: Object.entries(kept.parts).map(([name, k]) => ({ name, ok: false, retained: k.events.length > 0, count: k.events.length, dataAt: k.at })) } : {}),
        durationMs: t - startedAt, checkedAt: t,
      },
    };
    store.set(meta.key, { good: prev?.good, last: { result, at: t, ok: false } });
    return result;
  }
}

/**
 * Run one source. On success the result replaces the stored one. On failure the last good events
 * (if any) are served again, flagged `retained`, so a failing source never makes data vanish.
 * With `reuseFresh`, a recent snapshot is served as-is, and concurrent callers share one fetch.
 */
export async function runSource(loader: SourceLoader, store: LastGoodStore, opts: RunOptions = {}): Promise<SourceResult> {
  const now = opts.now ?? Date.now;
  const { meta } = loader;
  if (opts.reuseFresh) {
    const last = store.get(meta.key)?.last;
    const ttl = last?.ok ? meta.refreshSeconds * 1000 : Math.min(FAILURE_BACKOFF_MS, meta.refreshSeconds * 1000);
    if (last && now() - last.at < ttl) return last.result;
    const running = store.inflight.get(meta.key);
    if (running) return running;
  }
  const run = execute(loader, store, opts);
  if (opts.reuseFresh) {
    store.inflight.set(meta.key, run);
    void run.finally(() => store.inflight.delete(meta.key));
  }
  return run;
}

/** Run several sources in parallel; one failing never affects the others. */
export function runSources(loaders: SourceLoader[], store: LastGoodStore, opts: RunOptions = {}): Promise<SourceResult[]> {
  return Promise.all(loaders.map(l => runSource(l, store, opts)));
}
