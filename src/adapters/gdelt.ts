/**
 * GDELT Adapter — Global Conflict & Violence News
 *
 * GDELT (Global Database of Events, Language and Tone) monitors the world's
 * broadcast, print, and web news media 24h/7d and provides a free, no-key API.
 *
 * We use the Document API in artlist mode to fetch recent conflict/violence
 * news, then extract country location from article titles using a lookup table.
 *
 * API: https://api.gdeltproject.org/api/v2/doc/doc
 * Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 *
 * NOTE: GDELT returns news *articles* about conflicts, not raw event records.
 * Titles almost always mention the country where the conflict occurred.
 */

import type { VigilEvent, Severity } from '../types';

// ─── API types ─────────────────────────────────────────────

interface GDELTArticle {
  url:           string;
  title:         string;
  seendate:      string;   // "20240115T120000Z"
  domain:        string;   // news source domain
  language:      string;
  sourcecountry: string;   // country of publication (not event location)
}

interface GDELTResponse {
  articles?: GDELTArticle[];
}

// ─── Country → [lat, lng] lookup ──────────────────────────
// Conflict news almost always names the country in the headline.

const CONFLICT_COORDS: Record<string, [number, number]> = {
  // Middle East
  'Gaza':            [31.354, 34.308],
  'Israel':          [31.046, 34.851],
  'Palestine':       [31.952, 35.233],
  'West Bank':       [31.952, 35.233],
  'Lebanon':         [33.854, 35.862],
  'Syria':           [34.802, 38.997],
  'Iraq':            [33.223, 43.679],
  'Iran':            [32.427, 53.688],
  'Yemen':           [15.553, 48.516],
  'Saudi Arabia':    [23.886, 45.079],
  'Jordan':          [30.586, 36.238],
  // Africa
  'Sudan':           [12.862, 30.218],
  'South Sudan':     [6.877,  31.307],
  'Somalia':         [5.152,  46.200],
  'Ethiopia':        [9.145,  40.490],
  'Nigeria':         [9.082,   8.675],
  'Mali':            [17.571, -3.996],
  'Niger':           [17.608,  8.082],
  'Burkina Faso':    [12.364, -1.532],
  'Chad':            [15.454, 18.732],
  'Cameroon':        [3.848,  11.502],
  'DRC':             [-4.038, 21.759],
  'Congo':           [-4.038, 21.759],
  'Democratic Republic of the Congo': [-4.038, 21.759],
  'CAR':             [6.611,  20.939],
  'Central African Republic': [6.611, 20.939],
  'Libya':           [26.335, 17.229],
  'Egypt':           [26.820, 30.802],
  'Tunisia':         [33.887,  9.537],
  'Algeria':         [28.034,  1.659],
  'Morocco':         [31.792, -7.092],
  'Uganda':          [1.373,  32.290],
  'Kenya':           [-0.024, 37.906],
  'Tanzania':        [-6.369, 34.889],
  'Zimbabwe':        [-19.015, 29.155],
  'Mozambique':      [-18.665, 35.530],
  // Europe / Former Soviet
  'Ukraine':         [48.379, 31.165],
  'Russia':          [61.524, 105.319],
  'Kosovo':          [42.602, 20.903],
  'Serbia':          [44.017, 21.006],
  'Moldova':         [47.412, 28.370],
  'Georgia':         [42.315, 43.357],
  'Armenia':         [40.069, 45.038],
  'Azerbaijan':      [40.143, 47.577],
  // South/Southeast Asia
  'Afghanistan':     [33.939, 67.710],
  'Pakistan':        [30.375, 69.345],
  'India':           [20.594, 78.963],
  'Myanmar':         [21.916, 95.956],
  'Bangladesh':      [23.685, 90.356],
  'Sri Lanka':       [7.873,  80.772],
  'Philippines':     [12.880, 121.774],
  'Thailand':        [15.870, 100.993],
  'Indonesia':       [-0.789, 113.921],
  // Latin America
  'Mexico':          [23.634, -102.553],
  'Colombia':        [4.571, -74.297],
  'Venezuela':       [6.424, -66.590],
  'Brazil':          [-14.235, -51.925],
  'Ecuador':         [-1.831, -78.183],
  'Peru':            [-9.190, -75.015],
  'Haiti':           [18.971, -72.285],
  'Honduras':        [15.200, -86.242],
  'Guatemala':       [15.784, -90.231],
  'El Salvador':     [13.794, -88.897],
  // Other
  'China':           [35.862, 104.195],
  'North Korea':     [40.339, 127.510],
  'Taiwan':          [23.698, 120.960],
  'Papua New Guinea':[-6.315, 143.956],
};

// ─── Country name extraction ───────────────────────────────

// Sorted longest→shortest so "Democratic Republic of the Congo" matches before "Congo"
const SORTED_COUNTRIES = Object.keys(CONFLICT_COORDS)
  .sort((a, b) => b.length - a.length);

function extractLocation(title: string): { country: string; coords: [number, number] } | null {
  const lower = title.toLowerCase();
  for (const country of SORTED_COUNTRIES) {
    if (lower.includes(country.toLowerCase())) {
      return { country, coords: CONFLICT_COORDS[country] };
    }
  }
  return null;
}

// ─── Severity from title text ──────────────────────────────

function gdeltSeverity(title: string): Severity {
  const t = title.toLowerCase();
  if (/\b(\d{2,3})\s*(killed|dead|died|fatalities)/.test(t)) {
    const m = t.match(/\b(\d+)\s*(killed|dead|died)/);
    if (m && parseInt(m[1], 10) >= 50) return 'critical';
    if (m && parseInt(m[1], 10) >= 10) return 'high';
    return 'medium';
  }
  if (/killed|dead|fatalities|massacre|slaughter/.test(t)) return 'high';
  if (/attack|clash|battle|airstrike|bombing|shelling|wounded|injured/.test(t)) return 'medium';
  if (/conflict|war|troops|offensive|ceasefire/.test(t)) return 'low';
  return 'info';
}

// ─── Category from title ───────────────────────────────────

function gdeltCategory(title: string): 'armed-conflict' | 'protest' {
  const t = title.toLowerCase();
  if (/protest|demonstrat|rally|march|riot/.test(t)) return 'protest';
  return 'armed-conflict';
}

// ─── Timestamp from GDELT seendate ────────────────────────

function seendateToISO(seendate: string): string {
  // "20240115T120000Z" → "2024-01-15T12:00:00Z"
  const s = seendate.replace('Z', '');
  if (s.length < 15) return new Date().toISOString();
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
}

// ─── Stable ID from URL ────────────────────────────────────

function urlToId(url: string): string {
  // Hash-like stable ID from URL without external libs
  let h = 0;
  for (let i = 0; i < Math.min(url.length, 64); i++) {
    h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

// ─── Main fetch ────────────────────────────────────────────

const GDELT_URL = '/api/gdelt';

export async function fetchGDELT(): Promise<VigilEvent[]> {
  const response = await fetch(GDELT_URL);

  if (!response.ok) {
    throw new Error(`GDELT fetch failed: ${response.status} ${response.statusText}`);
  }

  // GDELT sometimes returns empty body or HTML error page when rate-limited
  // or when no results match. Parse as text first to handle gracefully.
  const text = await response.text();
  if (!text || !text.trimStart().startsWith('{')) {
    return [];  // empty or non-JSON response → no events
  }

  let json: GDELTResponse;
  try {
    json = JSON.parse(text) as GDELTResponse;
  } catch {
    return [];  // malformed JSON from GDELT → no events
  }

  const articles = json.articles ?? [];

  const events: VigilEvent[] = [];

  for (const article of articles) {
    if (!article.title) continue;

    const location = extractLocation(article.title);
    if (!location) continue;  // can't place it on the map

    const [lat, lng] = location.coords;
    const severity  = gdeltSeverity(article.title);
    const category  = gdeltCategory(article.title);
    const timestamp = seendateToISO(article.seendate ?? '');

    const tags: string[] = [
      'conflict',
      'news',
      location.country.toLowerCase().replace(/\s+/g, '-'),
    ];
    if (category === 'protest') tags.push('protest');

    events.push({
      id:       `gdelt-${urlToId(article.url)}`,
      timestamp,
      domain:   'conflict',
      category,
      severity,
      title:    article.title,
      description: `Reported by ${article.domain}.`,
      location: {
        lat,
        lng,
        country: location.country,
        region:  location.country,
        label:   location.country,
      },
      source:    'GDELT',
      sourceUrl: article.url,
      confidence: 0.70,   // news-derived, lower than structured event data
      tags,
      metadata: {
        domain:        article.domain,
        sourcecountry: article.sourcecountry,
        language:      article.language,
      },
    });
  }

  return events;
}
