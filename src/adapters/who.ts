/**
 * Health Adapter — Disease Outbreak News (GDELT Document API)
 *
 * WHO RSS, ReliefWeb, and all proxy approaches fail with 403/404.
 * GDELT monitors global news 24/7 and provides a free, no-key,
 * CORS-enabled API — the same infrastructure as our conflict adapter.
 * We query it with disease/outbreak keywords to surface health events.
 *
 * API: https://api.gdeltproject.org/api/v2/doc/doc
 * Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 */

import type { VigilEvent, Severity } from '../types';

// ─── API types (same shape as GDELT conflict adapter) ─────

interface GDELTArticle {
  url:           string;
  title:         string;
  seendate:      string;   // "20240115T120000Z"
  domain:        string;
  language:      string;
  sourcecountry: string;
}

interface GDELTResponse {
  articles?: GDELTArticle[];
}

// ─── Country → [lat, lng] lookup ──────────────────────────
// Outbreak-prone countries where disease events are most commonly reported

const OUTBREAK_COORDS: Record<string, [number, number]> = {
  // Africa
  'Democratic Republic of the Congo': [-4.038,  21.759],
  'DRC':             [-4.038,  21.759],
  'Congo':           [-4.038,  21.759],
  'Nigeria':         [9.082,    8.675],
  'Ethiopia':        [9.145,   40.490],
  'Somalia':         [5.152,   46.200],
  'Sudan':           [12.862,  30.218],
  'South Sudan':     [6.877,   31.307],
  'Uganda':          [1.373,   32.290],
  'Kenya':           [-0.024,  37.906],
  'Tanzania':        [-6.369,  34.889],
  'Mozambique':      [-18.665, 35.530],
  'Zimbabwe':        [-19.015, 29.155],
  'Malawi':          [-13.254, 34.302],
  'Zambia':          [-13.133, 27.849],
  'Angola':          [-11.202, 17.874],
  'Rwanda':          [-1.940,  29.874],
  'Burundi':         [-3.373,  29.919],
  'Chad':            [15.454,  18.732],
  'Niger':           [17.608,   8.082],
  'Mali':            [17.571,  -3.996],
  'Burkina Faso':    [12.364,  -1.532],
  'Cameroon':        [3.848,   11.502],
  'Ghana':           [7.947,   -1.023],
  'Guinea':          [11.373, -11.737],
  'Sierra Leone':    [8.461,  -11.780],
  'Liberia':         [6.428,   -9.430],
  'Senegal':         [14.497, -14.452],
  'Madagascar':      [-18.767, 46.869],
  // Asia
  'India':           [20.594,  78.963],
  'Pakistan':        [30.375,  69.345],
  'Bangladesh':      [23.685,  90.356],
  'Afghanistan':     [33.939,  67.710],
  'Myanmar':         [21.916,  95.956],
  'Cambodia':        [12.566, 104.991],
  'Vietnam':         [14.058, 108.277],
  'Thailand':        [15.870, 100.993],
  'Indonesia':       [-0.789, 113.921],
  'Philippines':     [12.880, 121.774],
  'China':           [35.862, 104.195],
  'Papua New Guinea':[-6.315, 143.956],
  // Middle East
  'Yemen':           [15.553,  48.516],
  'Syria':           [34.802,  38.997],
  'Iraq':            [33.223,  43.679],
  'Iran':            [32.427,  53.688],
  // Americas
  'Haiti':           [18.971, -72.285],
  'Brazil':          [-14.235,-51.925],
  'Colombia':        [4.571,  -74.297],
  'Venezuela':       [6.424,  -66.590],
  'Peru':            [-9.190, -75.015],
  'Bolivia':         [-16.290, -63.589],
  'Ecuador':         [-1.831, -78.183],
  'Honduras':        [15.200, -86.242],
  'Guatemala':       [15.784, -90.231],
  'Mexico':          [23.634,-102.553],
  // Global/default fallbacks
  'United States':   [37.090, -95.713],
  'United Kingdom':  [55.378,  -3.436],
};

const SORTED_COUNTRIES = Object.keys(OUTBREAK_COORDS)
  .sort((a, b) => b.length - a.length);

function extractLocation(title: string): { country: string; coords: [number, number] } | null {
  const lower = title.toLowerCase();
  for (const country of SORTED_COUNTRIES) {
    if (lower.includes(country.toLowerCase())) {
      return { country, coords: OUTBREAK_COORDS[country] };
    }
  }
  return null;
}

// ─── Severity ─────────────────────────────────────────────

function healthSeverity(title: string): Severity {
  const t = title.toLowerCase();
  if (/\b(\d+)\s*(dead|killed|deaths|fatalities)/.test(t)) {
    const m = t.match(/\b(\d+)\s*(dead|killed|deaths|fatalities)/);
    if (m && parseInt(m[1], 10) >= 10) return 'high';
    return 'medium';
  }
  if (/death|fatal|killed|dead/.test(t))                    return 'high';
  if (/outbreak|epidemic|spread|surge|cases|confirmed/.test(t)) return 'medium';
  return 'low';
}

// ─── Timestamp from GDELT seendate ────────────────────────

function seendateToISO(seendate: string): string {
  const s = seendate.replace('Z', '');
  if (s.length < 15) return new Date().toISOString();
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}Z`;
}

// ─── Stable ID ────────────────────────────────────────────

function urlToId(url: string): string {
  let h = 0;
  for (let i = 0; i < Math.min(url.length, 64); i++) {
    h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

// ─── GDELT query ──────────────────────────────────────────

const GDELT_HEALTH_URL =
  'https://api.gdeltproject.org/api/v2/doc/doc' +
  '?query=(cholera+OR+ebola+OR+mpox+OR+dengue+OR+measles' +
  '+OR+"bird+flu"+OR+outbreak+OR+epidemic+OR+marburg' +
  '+OR+lassa+OR+typhoid+OR+monkeypox+OR+polio)' +
  '+sourcelang:english' +
  '&mode=artlist' +
  '&maxrecords=30' +
  '&format=json' +
  '&timespan=3d';

// ─── Main fetch ────────────────────────────────────────────

export async function fetchWHOOutbreaks(): Promise<VigilEvent[]> {
  const response = await fetch(GDELT_HEALTH_URL);

  if (!response.ok) {
    throw new Error(`GDELT health fetch failed: ${response.status} ${response.statusText}`);
  }

  // GDELT can return empty or non-JSON when rate-limited or no results
  const text = await response.text();
  if (!text || !text.trimStart().startsWith('{')) {
    return [];
  }

  let json: GDELTResponse;
  try {
    json = JSON.parse(text) as GDELTResponse;
  } catch {
    return [];
  }

  const events: VigilEvent[] = [];

  for (const article of json.articles ?? []) {
    if (!article.title) continue;

    const loc = extractLocation(article.title);
    if (!loc) continue;

    const [lat, lng] = loc.coords;

    events.push({
      id:        `health-gdelt-${urlToId(article.url)}`,
      timestamp: seendateToISO(article.seendate ?? ''),
      domain:    'health',
      category:  'outbreak',
      severity:  healthSeverity(article.title),
      title:     article.title,
      description: `Reported by ${article.domain}.`,
      location: {
        lat,
        lng,
        country: loc.country,
        region:  loc.country,
        label:   loc.country,
      },
      source:    'WHO',
      sourceUrl: article.url,
      confidence: 0.65,
      tags: [
        'outbreak',
        'health',
        loc.country.toLowerCase().replace(/\s+/g, '-'),
      ],
      metadata: {
        country:       loc.country,
        domain:        article.domain,
        sourcecountry: article.sourcecountry,
      },
    });
  }

  return events;
}
