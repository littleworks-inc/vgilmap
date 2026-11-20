/**
 * GDELT allows one request per 5 seconds. The conflict and economic adapters both call our
 * GDELT proxies when the page loads, which used to trip that limit by themselves (HTTP 429).
 * This makes them take turns.
 *
 * A response that came from the CDN cache carries an `Age` header and never reached GDELT,
 * so when the previous response was cached the next call goes immediately.
 */
const GAP_MS = 6_000;

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
