/**
 * NASA FIRMS proxy — Vercel Edge Function.
 *
 * Fetches the last 24h of global VIIRS active-fire detections server-side, keeps only the
 * strongest `KEEP` by Fire Radiative Power, and returns them as a small CSV with the same
 * columns the browser adapter already parses. This:
 *   - keeps the FIRMS key off the client (it used to ship in the JS bundle as VITE_*),
 *   - turns a ~3 MB download per visitor into ~25 KB, cached at the CDN.
 *
 * Satellites: NASA's Suomi-NPP feed (VIIRS_SNPP_NRT) stopped updating on 2026-11-02, so we use
 * NOAA-20 first and NOAA-21 as a fallback. Check /api/data_availability if this goes empty again.
 *
 * Key: NASA_FIRMS_API_KEY (preferred) or the legacy VITE_NASA_FIRMS_API_KEY name.
 */
export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*' };

const SOURCES = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'] as const;
const KEEP = 150;
const TIMEOUT_MS = 20_000;

async function fetchSource(source: string, key: string, days: number): Promise<string | null> {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/-180,-90,180,90/${days}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const text = await res.text();
    // FIRMS answers HTML for bad keys, and a header-only CSV when a satellite feed is stale.
    if (text.trimStart().startsWith('<')) return null;
    return text.indexOf('\n') !== -1 && text.trim().split('\n').length > 1 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Header + the KEEP rows with the highest FRP, ignoring low-confidence detections.
 * (About 15% of VIIRS detections, and ~40% of the highest-FRP ones, are flagged low confidence:
 * sun glint, hot bare ground, industrial heat. Ranking by FRP alone put those on top.)
 * Deliberately allocation-light: a day of NOAA-20 data is ~36k rows (~3 MB) and edge functions
 * have tight CPU limits. Instead of splitting every line, we locate just the `frp` field,
 * keep a small running top-K, and only sort when that buffer fills (~11 ms vs ~50 ms naive).
 */
function topByFrp(csv: string): string {
  const nl0 = csv.indexOf('\n');
  const header = csv.slice(0, nl0).replace(/\r$/, '');
  const frpIdx = header.split(',').map(h => h.trim()).indexOf('frp');
  if (frpIdx === -1) return header;
  const confIdx = header.split(',').map(h => h.trim()).indexOf('confidence'); // -1 → don't filter

  let top: Array<[number, string]> = [];
  let floor = -Infinity; // FRP of the current KEEP-th row; anything below can be skipped cheaply
  let pos = nl0 + 1;
  const len = csv.length;

  while (pos < len) {
    let end = csv.indexOf('\n', pos);
    if (end === -1) end = len;

    let start = pos;
    let confStart = -1;
    for (let c = 0; c < frpIdx; c++) {
      if (c === confIdx) confStart = start;
      start = csv.indexOf(',', start) + 1;
      if (start === 0) break; // ran out of fields
    }
    // VIIRS confidence is a single letter: l / n / h
    const lowConfidence = confStart !== -1 && csv.charCodeAt(confStart) === 108 /* 'l' */;
    if (!lowConfidence && start > 0 && start <= end) {
      let fieldEnd = csv.indexOf(',', start);
      if (fieldEnd === -1 || fieldEnd > end) fieldEnd = end;
      const frp = +csv.slice(start, fieldEnd);
      if (frp > floor) {
        top.push([frp, csv.slice(pos, end).replace(/\r$/, '')]);
        if (top.length >= KEEP * 3) {
          top.sort((a, b) => b[0] - a[0]);
          top = top.slice(0, KEEP);
          floor = top[KEEP - 1][0];
        }
      }
    }
    pos = end + 1;
  }

  top.sort((a, b) => b[0] - a[0]);
  return [header, ...top.slice(0, KEEP).map(r => r[1])].join('\n');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const key = process.env.NASA_FIRMS_API_KEY ?? process.env.VITE_NASA_FIRMS_API_KEY ?? 'DEMO_KEY';

  // The day range counts from the current UTC day, so for the first hours after 00:00 UTC a
  // 1-day request is header-only (no satellite has reported for "today" yet). Retry with 2 days
  // then, so the map shows yesterday's fires instead of a spurious 502.
  const attempts = SOURCES.flatMap(source => [[source, 1], [source, 2]] as const);
  for (const [source, days] of attempts) {
    const csv = await fetchSource(source, key, days);
    if (csv) {
      return new Response(topByFrp(csv), {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': 'text/csv; charset=utf-8',
          'X-Firms-Source': source,
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300',
        },
      });
    }
  }
  return new Response('FIRMS unavailable: no satellite feed returned data', {
    status: 502,
    headers: CORS,
  });
}
