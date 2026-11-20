/**
 * GDELT allows one request per 5 seconds. The conflict and economic adapters both call our
 * GDELT proxies when the page loads, which used to trip that limit by themselves (HTTP 429).
 * This makes them take turns.
 *
 * A response that came from the CDN cache carries an `Age` header and never reached GDELT,
 * so when the previous response was cached the next call goes immediately.
 */
import { addWarning } from './source-warnings';

const GAP_MS = 6_000;

/**
 * Our GDELT proxies fall back to the last good result when GDELT is down and say so in the
 * `X-Gdelt-Source: stale` header. Report that to the Data Health panel, otherwise cached data
 * would be shown as plainly "live".
 */
export function noteIfStale(sourceKey: string, res: Response): void {
  if (res.headers.get('x-gdelt-source') !== 'stale') return;
  const secs = Number(res.headers.get('x-gdelt-age-seconds'));
  const mins = Math.round(secs / 60);
  const age = Number.isFinite(secs) && secs > 0 ? (mins < 1 ? 'under a minute' : mins < 120 ? `${mins} min` : `${Math.round(mins / 60)} h`) : 'earlier';
  addWarning(sourceKey, `GDELT unavailable — showing cached data from ${age} ago`);
}

let tail: Promise<unknown> = Promise.resolve();
let lastWasLive = false;
let lastEnd = 0;

export function gdeltFetch(url: string): Promise<Response> {
  const run = tail.then(async () => {
    if (lastWasLive) {
      const wait = lastEnd + GAP_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    try {
      const res = await fetch(url);
      lastWasLive = !res.headers.get('age'); // no Age header → origin was called, GDELT was hit
      return res;
    } catch (err) {
      lastWasLive = true;
      throw err;
    } finally {
      lastEnd = Date.now();
    }
  });
  tail = run.catch(() => undefined);
  return run;
}
