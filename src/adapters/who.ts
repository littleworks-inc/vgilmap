/**
 * Health Adapter — Disease Outbreak Reports (ReliefWeb API)
 *
 * WHO's RSS feeds are unreliable (paths change, proxies blocked).
 * Instead we use the ReliefWeb API — a free, no-key, CORS-enabled REST API
 * operated by UN OCHA that aggregates authoritative humanitarian reports
 * including WHO Disease Outbreak News.
 *
 * API docs: https://apidoc.rwlabs.org/
 * Endpoint: https://api.reliefweb.int/v1/reports
 *
 * ReliefWeb returns structured country data with lat/lon already embedded,
 * so no country-name extraction or coordinate lookup table is needed.
 */

import type { VigilEvent, Severity } from '../types';

// ─── API types ─────────────────────────────────────────────

interface AllOriginsResponse {
  contents: string;
  status: { url: string; content_type: string; http_code: number };
}

interface RWCountry {
  id:        number;
  name:      string;
  iso3:      string;
  shortname: string;
  location?: { lat: number; lon: number };
}

interface RWReport {
  id:     string;
  fields: {
    title:     string;
    date?:     { created?: string; original?: string };
    country?:  RWCountry[];
    url_alias?: string;
    body?:     string;
  };
}

interface RWResponse {
  data:  RWReport[];
  count: number;
  total: number;
}

// ─── Fetch config ──────────────────────────────────────────

// ReliefWeb blocks browser CORS requests (403). We route through allorigins.win,
// a free CORS proxy that makes the request server-to-server and wraps the
// response as: { contents: "<json string>", status: { http_code: 200 } }
const RELIEFWEB_QUERY =
  'https://api.reliefweb.int/v1/reports' +
  '?appname=VigilMap' +
  '&query[value]=disease+OR+outbreak+OR+epidemic+OR+cholera+OR+mpox+OR+ebola+OR+dengue+OR+measles+OR+influenza' +
  '&filter[field]=theme.name&filter[value]=Health' +
  '&sort[]=date.created:desc' +
  '&limit=50' +
  '&fields[include][]=title' +
  '&fields[include][]=date' +
  '&fields[include][]=country' +
  '&fields[include][]=url_alias';

const FETCH_URL = `https://api.allorigins.win/get?url=${encodeURIComponent(RELIEFWEB_QUERY)}`;

// ─── Disease keyword filter ────────────────────────────────

const OUTBREAK_KEYWORDS = [
  'outbreak', 'disease', 'virus', 'epidemic', 'cases',
  'cholera', 'mpox', 'ebola', 'dengue', 'measles',
  'influenza', 'avian', 'plague', 'monkeypox', 'polio',
  'marburg', 'lassa', 'typhoid', 'hepatitis', 'leprosy',
];

function isOutbreakTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return OUTBREAK_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Severity ─────────────────────────────────────────────

function whoSeverity(title: string, body: string): Severity {
  const text = (title + ' ' + body).toLowerCase();
  if (/death|fatal|killed/.test(text))        return 'high';
  if (/outbreak|cases|confirmed/.test(text)) {
    const m = text.match(/(\d+)\s*(cases|confirmed|reported|deaths)/);
    if (m && parseInt(m[1], 10) > 100)        return 'medium';
    return 'medium';
  }
  return 'low';
}

// ─── Strip HTML ────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Stable ID ────────────────────────────────────────────

function rwId(id: string): string {
  return `rw-${id}`;
}

// ─── Main fetch ────────────────────────────────────────────

export async function fetchWHOOutbreaks(): Promise<VigilEvent[]> {
  const aoResponse = await fetch(FETCH_URL);

  if (!aoResponse.ok) {
    throw new Error(`allorigins fetch failed: ${aoResponse.status} ${aoResponse.statusText}`);
  }

  const aoJson: AllOriginsResponse = await aoResponse.json();

  if (aoJson.status?.http_code !== 200) {
    throw new Error(`ReliefWeb returned HTTP ${aoJson.status?.http_code ?? 'unknown'} via proxy`);
  }

  // allorigins returns the API response as a raw JSON string in `contents`
  let json: RWResponse;
  try {
    json = JSON.parse(aoJson.contents) as RWResponse;
  } catch {
    throw new Error('ReliefWeb response could not be parsed as JSON');
  }
  const events: VigilEvent[] = [];

  for (const report of json.data ?? []) {
    const { title, date, country: countries, url_alias, body } = report.fields;

    if (!title) continue;
    if (!isOutbreakTitle(title)) continue;

    // Need at least one country with coordinates to place on the map
    const country = countries?.find(c => c.location);
    if (!country?.location) continue;

    const { lat, lon: lng } = country.location;
    const cleanBody  = body ? stripHtml(body).slice(0, 300) : '';
    const severity   = whoSeverity(title, cleanBody);
    const timestamp  = date?.created ?? date?.original ?? new Date().toISOString();

    // Strip common prefixes like "WHO Disease Outbreak News:"
    const cleanTitle = title
      .replace(/^WHO\s+/i, '')
      .replace(/^Disease\s+Outbreak\s+News:\s*/i, '')
      .trim();

    events.push({
      id:          rwId(report.id),
      timestamp,
      domain:      'health',
      category:    'outbreak',
      severity,
      title:       cleanTitle,
      description: cleanBody,
      location: {
        lat,
        lng,
        country:  country.name,
        region:   country.name,
        label:    country.name,
      },
      source:    'WHO',
      sourceUrl: url_alias || 'https://reliefweb.int/updates?theme=Health',
      confidence: 0.90,
      tags: [
        'outbreak',
        'who',
        country.iso3.toLowerCase(),
      ],
      metadata: {
        country:    country.name,
        iso3:       country.iso3,
        raw_title:  title,
      },
    });
  }

  return events;
}
