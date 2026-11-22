/**
 * The ingestion engine: runs source loaders, keeps each source's last good result, and reports
 * per-source health. Pure and dependency-injected (loaders, store and clock are passed in), so it
 * runs identically in the Vercel function and in tests.
 */
import type { VigilEvent } from '../types';
import type { NormalizeResult } from '../adapters/result';
import type { SourceMeta } from './sources';
import { classify } from './health';
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
  durationMs: number;
  checkedAt: number;
  optional?: boolean;
  refreshSeconds: number;
  precision: SourceMeta['precision'];
  coverage: string;
}

export interface SourceResult {
  status: SourceStatus;
  events: VigilEvent[];
}

export interface LastGood { events: VigilEvent[]; at: number }
export interface LastGoodStore {
  get(key: string): LastGood | undefined;
  set(key: string, value: LastGood): void;
}

export class MemoryStore implements LastGoodStore {
  private m = new Map<string, LastGood>();
  get(key: string) { return this.m.get(key); }
  set(key: string, value: LastGood) { this.m.set(key, value); }
}

export interface RunOptions {
  now?: () => number;
  /** A loader that has not answered by then is treated as failed (edge functions must reply in ~25s). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

function baseStatus(meta: SourceMeta): Pick<SourceStatus, 'key' | 'label' | 'domain' | 'optional' | 'refreshSeconds' | 'precision' | 'coverage'> {
  return { key: meta.key, label: meta.label, domain: meta.domain, optional: meta.optional, refreshSeconds: meta.refreshSeconds, precision: meta.precision, coverage: meta.coverage };
}

/**
 * Run one source. On success the result replaces the stored one. On failure the last good events
 * (if any) are served again, flagged `retained`, so a failing source never makes data vanish.
 */
export async function runSource(loader: SourceLoader, store: LastGoodStore, opts: RunOptions = {}): Promise<SourceResult> {
  const now = opts.now ?? Date.now;
  const { meta } = loader;
  const startedAt = now();
  try {
    const { events: raw, warnings } = await withTimeout(loader.load(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, meta.label);
    const events = raw.map(e => withPrecision(e, meta.precision));
    const t = now();
    const prev = store.get(meta.key);
    store.set(meta.key, { events, at: t });
    const { status, newestAt } = classify(events, meta.staleAfterHours, warnings, t);
    return {
      events,
      status: {
        ...baseStatus(meta), status, count: events.length, newestAt, warnings,
        dataAt: t, lastOkAt: events.length > 0 ? t : prev?.events.length ? prev.at : undefined,
        durationMs: t - startedAt, checkedAt: t,
      },
    };
  } catch (reason) {
    const t = now();
    const error = reason instanceof Error ? reason.message : String(reason);
    const kept = store.get(meta.key);
    const retained = !!kept && kept.events.length > 0;
    return {
      events: retained ? kept.events : [],
      status: {
        ...baseStatus(meta), status: 'error', count: retained ? kept.events.length : 0,
        newestAt: retained ? classify(kept.events, meta.staleAfterHours, [], t).newestAt : undefined,
        warnings: [], error, retained: retained || undefined,
        dataAt: retained ? kept.at : undefined, lastOkAt: retained ? kept.at : undefined,
        durationMs: t - startedAt, checkedAt: t,
      },
    };
  }
}

/** Run several sources in parallel; one failing never affects the others. */
export function runSources(loaders: SourceLoader[], store: LastGoodStore, opts: RunOptions = {}): Promise<SourceResult[]> {
  return Promise.all(loaders.map(l => runSource(l, store, opts)));
}
