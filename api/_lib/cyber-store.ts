/**
 * Cyber history store — daily aggregate counters in Redis (Upstash, via Vercel Marketplace).
 *
 * Design: each UTC day is one hash per source, rebuilt from source data and OVERWRITTEN
 * (DEL + HSET), so re-running a backfill or the daily sync is idempotent and never
 * double-counts. Aggregates only — no raw victim records — keeps storage tiny and
 * keeps commands well inside free-tier limits.
 *
 *   cyber:r:{YYYY-MM-DD}  ransomware.live claims   fields: t, c:{CC}, s:{sector}, g:{group}
 *   cyber:k:{YYYY-MM-DD}  CISA KEV additions       fields: t, v:{vendor}, r (ransomware-linked)
 *   cyber:meta            lastSync, lastMonth, ...
 *
 * Imported by both the edge functions in /api and the local backfill script.
 */
import { Redis } from '@upstash/redis';

// ── Redis client ───────────────────────────────────────────

/** Minimal surface we use, so tests can pass an in-memory fake. */
export interface RedisLike {
  pipeline(): {
    del(key: string): unknown;
    hset(key: string, data: Record<string, number | string>): unknown;
    hgetall(key: string): unknown;
    exec<T = unknown[]>(): Promise<T>;
  };
  hset(key: string, data: Record<string, number | string>): Promise<unknown>;
  hgetall<T = Record<string, string>>(key: string): Promise<T | null>;
}

export function getRedis(): RedisLike {
  // Vercel Marketplace's Upstash integration injects KV_REST_API_*; Upstash itself uses UPSTASH_REDIS_REST_*.
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('Redis not configured: set KV_REST_API_URL and KV_REST_API_TOKEN');
  }
  return new Redis({ url, token }) as unknown as RedisLike;
}

// ── Source types ───────────────────────────────────────────

export interface RansomVictimRaw {
  victim?: string;
  group?: string;
  country?: string;
  activity?: string;
  attackdate?: string;
  discovered?: string;
}

export interface KevRaw {
  cveID?: string;
  vendorProject?: string;
  dateAdded?: string;
  knownRansomwareCampaignUse?: string;
}

type Counts = Record<string, number>;

// ── Aggregation (pure) ─────────────────────────────────────

const DAY_RE = /^(\d{4}-\d{2}-\d{2})/;

export function normSector(a?: string): string {
  const s = (a ?? '').trim();
  return !s || s.toLowerCase() === 'not found' ? 'Unknown' : s;
}

function bump(c: Counts, field: string) {
  c[field] = (c[field] ?? 0) + 1;
}

/**
 * Bucket victims by attack day. `month` ("YYYY-MM") restricts output: the archive's
 * monthly files contain ~2% stragglers from neighbouring months, and writing those
 * would overwrite another month's complete day with a partial one.
 */
export function aggregateVictims(list: unknown, month?: string): Map<string, Counts> {
  const days = new Map<string, Counts>();
  if (!Array.isArray(list)) return days;
  for (const v of list as RansomVictimRaw[]) {
    const day = DAY_RE.exec(v.attackdate ?? v.discovered ?? '')?.[1];
    if (!day || !v.group) continue;
    if (month && !day.startsWith(month)) continue;
    let c = days.get(day);
    if (!c) days.set(day, (c = {}));
    bump(c, 't');
    bump(c, `c:${(v.country ?? '').toUpperCase() || '??'}`);
    bump(c, `s:${normSector(v.activity)}`);
    bump(c, `g:${v.group.toLowerCase()}`);
  }
  return days;
}

export function aggregateKev(list: unknown): Map<string, Counts> {
  const days = new Map<string, Counts>();
  if (!Array.isArray(list)) return days;
  for (const v of list as KevRaw[]) {
    const day = DAY_RE.exec(v.dateAdded ?? '')?.[1];
    if (!day) continue;
    let c = days.get(day);
    if (!c) days.set(day, (c = {}));
    bump(c, 't');
    bump(c, `v:${(v.vendorProject ?? 'unknown').toLowerCase()}`);
    if (v.knownRansomwareCampaignUse === 'Known') bump(c, 'r');
  }
  return days;
}

// ── Writes ─────────────────────────────────────────────────

const CHUNK = 200; // keys per pipeline round-trip

async function writeDays(
  redis: RedisLike,
  prefix: 'cyber:r:' | 'cyber:k:',
  days: Map<string, Counts>,
): Promise<number> {
  const entries = [...days.entries()];
  for (let i = 0; i < entries.length; i += CHUNK) {
    const p = redis.pipeline();
    for (const [day, counts] of entries.slice(i, i + CHUNK)) {
      p.del(`${prefix}${day}`);
      p.hset(`${prefix}${day}`, counts);
    }
    await p.exec();
  }
  return entries.length;
}

/** Rebuild every day found in `victims` (restricted to `month`). Returns days written. */
export const writeVictimDays = (redis: RedisLike, victims: unknown, month?: string) =>
  writeDays(redis, 'cyber:r:', aggregateVictims(victims, month));

export const writeKevDays = (redis: RedisLike, kev: unknown) =>
  writeDays(redis, 'cyber:k:', aggregateKev(kev));

export async function markSynced(redis: RedisLike, extra: Record<string, string | number> = {}) {
  await redis.hset('cyber:meta', { lastSync: new Date().toISOString(), ...extra });
}

// ── Source fetching ────────────────────────────────────────

export const KEV_URL =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

export class RateLimitedError extends Error {}

/** ransomware.live archive: one month of claims. Limited to 1 request/minute. */
export async function fetchVictimMonth(year: number, month: number): Promise<unknown[]> {
  const mm = String(month).padStart(2, '0');
  const res = await fetch(`https://api.ransomware.live/v2/victims/${year}/${mm}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`ransomware.live ${year}/${mm}: HTTP ${res.status}`);
  const json = await res.json();
  if (Array.isArray(json)) return json;
  // Rate-limit responses are a 200 with {"message": "1 per 1 minute"}.
  const msg = (json as { message?: string })?.message ?? '';
  if (/per \d+ (minute|second|hour)/i.test(msg)) throw new RateLimitedError(msg);
  throw new Error(`ransomware.live ${year}/${mm}: unexpected response ${JSON.stringify(json).slice(0, 120)}`);
}

export async function fetchKevAll(): Promise<KevRaw[]> {
  const res = await fetch(KEV_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CISA KEV: HTTP ${res.status}`);
  const json = (await res.json()) as { vulnerabilities?: KevRaw[] };
  return json.vulnerabilities ?? [];
}

// ── Reads ──────────────────────────────────────────────────

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Last `n` UTC days ending today, oldest first, with their counters (empty object if no data). */
export async function readDays(
  redis: RedisLike,
  prefix: 'cyber:r:' | 'cyber:k:',
  n: number,
): Promise<Array<{ day: string; counts: Counts }>> {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) days.push(dayKey(new Date(Date.now() - i * 86_400_000)));
  const p = redis.pipeline();
  for (const d of days) p.hgetall(`${prefix}${d}`);
  const rows = await p.exec<Array<Record<string, string | number> | null>>();
  return days.map((day, i) => {
    const counts: Counts = {};
    for (const [k, v] of Object.entries(rows[i] ?? {})) counts[k] = Number(v);
    return { day, counts };
  });
}
