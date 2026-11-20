/**
 * Shared GDELT DOC API client for the edge proxies (conflict, economic).
 *
 * What we learned the hard way about GDELT:
 *   - It is SLOW: ~13 s per request even when called politely. The old proxies gave up after
 *     6-7 s, so almost every call timed out.
 *   - Hard rate limit of one request per 5 s (HTTP 429 or a plain-text "Please limit requests…"),
 *     with a cool-off after bursts. Separate endpoints calling it at once tripped it constantly.
 *   - Bad queries come back as HTTP 200 plain text (e.g. "Queries containing OR'd terms must be
 *     surrounded by ()"), and "nothing found" comes back as `{}`.
 *
 * So this module: serialises calls per instance with a minimum gap, uses a realistic timeout,
 * retries once after a 429, treats `{}`/text as non-success, and — most important — keeps the
 * last good result (in memory, and in Redis when configured) to serve when GDELT is down.
 * Good responses are also cached at the CDN for 15 min, so GDELT is rarely called at all.
 */
import { getRedis } from './cyber-store';

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const USER_AGENT = 'VigilMap/1.0 (https://github.com/littleworks-inc/vgilmap)';

const MIN_GAP_MS = 6_000;          // GDELT allows 1 request / 5 s; keep a margin
const BUDGET_MS = 23_000;          // Vercel edge must start responding within ~25 s
const MAX_REQUEST_MS = 20_000;
const STALE_MAX_AGE_MS = 6 * 3_600_000; // older than this, "last good" is no longer worth serving
const FAILURE_BACKOFF_MS = 45_000;      // after a failed round, don't hit GDELT again for this long

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Per-instance request spacing ───────────────────────────

let queue: Promise<unknown> = Promise.resolve();
let lastStart = 0;

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

// ── One request ────────────────────────────────────────────

type Outcome =
  | { kind: 'ok'; body: string }
  | { kind: 'empty' }
  | { kind: 'rate-limited' }
  | { kind: 'error'; message: string };

async function requestOnce(query: string, timeoutMs: number): Promise<Outcome> {
  try {
    const res = await fetch(`${GDELT_URL}?${query}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = (await res.text()).trim();

    if (res.status === 429 || /^please limit requests/i.test(text)) return { kind: 'rate-limited' };
    if (!res.ok) return { kind: 'error', message: `GDELT HTTP ${res.status}` };
    if (text === '' || text === '{}') return { kind: 'empty' };
    if (!text.startsWith('{')) return { kind: 'error', message: `GDELT said: ${text.slice(0, 120)}` };

    const json = JSON.parse(text) as { articles?: unknown };
    if (!Array.isArray(json.articles)) return { kind: 'error', message: 'GDELT response had no articles array' };
    return json.articles.length === 0 ? { kind: 'empty' } : { kind: 'ok', body: text };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    return { kind: 'error', message: name === 'TimeoutError' || name === 'AbortError' ? 'GDELT timed out' : String(err) };
  }
}

// ── Last-good store (memory + optional Redis) ──────────────

const memory = new Map<string, { body: string; at: number }>();
const lastFailure = new Map<string, number>();

async function saveGood(name: string, body: string): Promise<void> {
  const at = Date.now();
  memory.set(name, { body, at });
  try {
    await getRedis().hset(`gdelt:last:${name}`, { body, at });
  } catch { /* Redis not configured or unreachable: memory only */ }
}

async function loadGood(name: string): Promise<{ body: string; at: number } | null> {
  let best = memory.get(name) ?? null;
  try {
    const h = await getRedis().hgetall<Record<string, unknown>>(`gdelt:last:${name}`);
    if (h?.body) {
      // Upstash auto-parses JSON-looking strings back into objects; normalise to text.
      const body = typeof h.body === 'string' ? h.body : JSON.stringify(h.body);
      const at = Number(h.at) || 0;
      if (!best || at > best.at) best = { body, at };
    }
  } catch { /* ignore */ }
  return best && Date.now() - best.at <= STALE_MAX_AGE_MS ? best : null;
}

// ── Public: answer a proxy request ─────────────────────────

/**
 * Try each query in order (e.g. a narrow then a wider time window) within the time budget.
 * Returns fresh data when possible, else the last good data, else an empty result.
 */
export async function serveGdelt(name: string, queries: string[]): Promise<Response> {
  const started = Date.now();
  let uncertain = false; // a failure/limit happened, so an "empty" answer can't be trusted

  // Recently failed? Don't make every visitor wait ~20 s and hit GDELT again: answer from
  // the last good data (or fail fast) and let the backoff expire.
  const recentlyFailed = Date.now() - (lastFailure.get(name) ?? 0) < FAILURE_BACKOFF_MS;
  if (recentlyFailed) uncertain = true;

  for (const query of recentlyFailed ? [] : queries) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (BUDGET_MS - (Date.now() - started) < 3_000) break;

      // Go through the spacing queue; the time budget is re-checked AFTER any wait in the queue,
      // since waiting for our turn eats into the ~25 s the edge runtime gives us.
      const out = await schedule<Outcome>(async () => {
        const remaining = BUDGET_MS - (Date.now() - started);
        if (remaining < 3_000) return { kind: 'error', message: 'out of time budget' };
        return requestOnce(query, Math.min(MAX_REQUEST_MS, remaining));
      });
      if (out.kind === 'ok') {
        await saveGood(name, out.body);
        return new Response(out.body, {
          status: 200,
          headers: {
            ...CORS,
            'X-Gdelt-Source': 'live',
            'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
          },
        });
      }
      if (out.kind === 'empty') break; // a valid "nothing here": try the next (wider) query
      uncertain = true;
      if (out.kind === 'rate-limited') continue; // one retry; schedule() spaces it out
      break; // timeout / bad response: retrying the same query won't help
    }
  }

  if (uncertain && !recentlyFailed) lastFailure.set(name, Date.now());

  const good = await loadGood(name);
  if (good) {
    return new Response(good.body, {
      status: 200,
      headers: {
        ...CORS,
        'X-Gdelt-Source': 'stale',
        'X-Gdelt-Age-Seconds': String(Math.round((Date.now() - good.at) / 1000)),
        'Cache-Control': 'public, s-maxage=60',
      },
    });
  }

  if (uncertain) {
    // A failure must NOT be a cacheable 200: with stale-while-revalidate the CDN would replace a
    // good cached copy with this empty one. A 503 is never stored, and the clients already
    // handle it (the conflict adapter falls back to its RSS feeds).
    return new Response(JSON.stringify({ articles: [], _error: 'GDELT unavailable' }), {
      status: 503,
      headers: { ...CORS, 'X-Gdelt-Source': 'unavailable', 'Cache-Control': 'no-store', 'Retry-After': '45' },
    });
  }

  // Every query answered cleanly with "nothing found": a trustworthy, cacheable empty result.
  return new Response(JSON.stringify({ articles: [] }), {
    status: 200,
    headers: { ...CORS, 'X-Gdelt-Source': 'live-empty', 'Cache-Control': 'public, s-maxage=300' },
  });
}

export const gdeltCors = CORS;
