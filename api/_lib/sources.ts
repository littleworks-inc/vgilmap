/**
 * Server-side source loaders: the ONLY place that knows upstream URLs, keys and proxy handlers.
 * Each loader fetches raw data and hands it to the shared normalizer, so the app and the public
 * API see exactly the same events. Secrets (NASA keys etc.) are read by the proxy handlers on
 * the server and never reach the browser.
 *
 * The raw proxy routes (/api/firms, /api/cyber, …) are called in-process here, not over HTTP.
 */
import { SOURCE_META } from '../../shared/pipeline/sources';
import type { SourceLoader } from '../../shared/pipeline/engine';
import type { NormalizeResult } from '../../shared/adapters/result';
import { normalizeUSGS, USGS_FEED_URL } from '../../shared/adapters/usgs';
import { normalizeUSGSSignificantWeek, USGS_SIGNIFICANT_WEEK_URL } from '../../shared/adapters/usgs-significant-week';
import { normalizeFirms } from '../../shared/adapters/nasa-firms';
import { normalizeNOAA } from '../../shared/adapters/noaa';
import { normalizeConflictNews, normalizeGDELT } from '../../shared/adapters/gdelt';
import { normalizeWHO, DON_URL } from '../../shared/adapters/who';
import { normalizeReliefWeb } from '../../shared/adapters/reliefweb';
import { normalizeEconomicNews } from '../../shared/adapters/economic-news';
import { normalizeScience } from '../../shared/adapters/science';
import { normalizeCyber } from '../../shared/adapters/cyber';
import { normalizeBreaches } from '../../shared/adapters/cyber-breaches';
import { normalizeCyberNews } from '../../shared/adapters/cyber-news';
import firms from '../firms';
import noaa from '../noaa';
import conflictRss from '../conflict-rss';
import gdelt from '../gdelt';
import reliefweb from '../reliefweb';
import economicRss from '../economic-rss';
import science from '../science';
import cyber from '../cyber';
import breaches from '../breaches';
import cyberNews from '../cyber-news';

type Handler = (req: Request) => Promise<Response>;

/** Call a raw proxy handler in-process and return its Response, throwing on a non-2xx status. */
async function call(name: string, handler: Handler, query = ''): Promise<Response> {
  const res = await handler(new Request(`http://internal/api/${name}${query}`));
  if (!res.ok) throw new Error(`${name} proxy ${res.status}`);
  return res;
}

async function getJson(url: string, what: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${what} returned ${res.status}`);
  return res.json();
}

/** How old a stale GDELT fallback is, in words. */
function staleAge(secs: number): string {
  const mins = Math.round(secs / 60);
  return Number.isFinite(secs) && secs > 0 ? (mins < 1 ? 'under a minute' : mins < 120 ? `${mins} min` : `${Math.round(mins / 60)} h`) : 'earlier';
}

const ok = (events: NormalizeResult['events'], warnings: string[] = []): NormalizeResult => ({ events, warnings });

const LOADERS: Record<string, () => Promise<NormalizeResult>> = {
  'usgs-day':   async () => ok(normalizeUSGS((await getJson(USGS_FEED_URL, 'USGS')) as Parameters<typeof normalizeUSGS>[0])),
  'usgs-week':  async () => ok(normalizeUSGSSignificantWeek((await getJson(USGS_SIGNIFICANT_WEEK_URL, 'USGS significant')) as Parameters<typeof normalizeUSGSSignificantWeek>[0])),
  'nasa-firms': async () => ok(normalizeFirms(await (await call('firms', firms)).text())),
  'noaa':       async () => ok(normalizeNOAA((await (await call('noaa', noaa, '?message_type=alert')).json()) as Parameters<typeof normalizeNOAA>[0])),
  'conflict-rss': async () => normalizeConflictNews(await (await call('conflict-rss', conflictRss)).json()),
  'gdelt': async () => {
    const res = await call('gdelt', gdelt);
    // The proxy serves its last good result (and says so) when GDELT itself is down.
    const warnings = res.headers.get('x-gdelt-source') === 'stale'
      ? [`GDELT unavailable — showing cached data from ${staleAge(Number(res.headers.get('x-gdelt-age-seconds')))} ago`] : [];
    return ok(normalizeGDELT(await res.json()), warnings);
  },
  'who':        async () => ok(normalizeWHO((await getJson(DON_URL, 'WHO DON API', { headers: { Accept: 'application/json' } })) as Parameters<typeof normalizeWHO>[0])),
  'reliefweb':  async () => ok(normalizeReliefWeb(await (await call('reliefweb', reliefweb)).text())),
  'economic-news': async () => normalizeEconomicNews(await (await call('economic-rss', economicRss)).json()),
  'science':    async () => normalizeScience(await (await call('science', science)).json()),
  'cyber':      async () => normalizeCyber(await (await call('cyber', cyber)).json()),
  'cyber-breaches': async () => ok(normalizeBreaches(await (await call('breaches', breaches)).json())),
  'cyber-news': async () => normalizeCyberNews(await (await call('cyber-news', cyberNews)).json()),
};

/** Every source, as a loader the shared engine can run. */
export const SERVER_LOADERS: SourceLoader[] = SOURCE_META.map(meta => {
  const load = LOADERS[meta.key];
  if (!load) throw new Error(`no loader for source "${meta.key}"`);
  return { meta, load };
});
