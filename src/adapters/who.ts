/**
 * WHO Adapter — Disease Outbreak News (RSS via Vite proxy)
 *
 * Fetches WHO's Disease Outbreak News (DON) RSS feed through a Vite
 * dev-server proxy (to avoid CORS), then parses the XML in the browser.
 *
 * RSS source: https://www.who.int/feeds/entity/csr/don/en/rss.xml
 * Proxy path: /api/who-rss  (configured in vite.config.ts)
 *
 * NOTE: In production, replace the proxy with a serverless function at
 *       /api/who-rss that forwards the request to WHO.
 */

import type { VigilEvent, Severity } from '../types';

// ─── Disease keyword filter ────────────────────────────────

const OUTBREAK_KEYWORDS = [
  'outbreak', 'disease', 'virus', 'epidemic', 'cases',
  'cholera', 'mpox', 'ebola', 'dengue', 'measles',
  'influenza', 'avian', 'plague', 'monkeypox', 'polio',
  'marburg', 'lassa', 'typhoid', 'hepatitis', 'leprosy',
];

function isOutbreakItem(title: string): boolean {
  const lower = title.toLowerCase();
  return OUTBREAK_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Country → [lat, lng] lookup ──────────────────────────

const COUNTRY_COORDS: Record<string, [number, number]> = {
  'Nigeria':                            [9.082,    8.675],
  'Democratic Republic of the Congo':   [-4.038,  21.759],
  'DRC':                                [-4.038,  21.759],
  'Congo':                              [-4.038,  21.759],
  'Ethiopia':                           [9.145,   40.490],
  'Somalia':                            [5.152,   46.200],
  'Sudan':                              [12.862,  30.218],
  'South Sudan':                        [6.877,   31.307],
  'Uganda':                             [1.373,   32.290],
  'Kenya':                              [-0.024,  37.906],
  'Chad':                               [15.454,  18.732],
  'Niger':                              [17.608,   8.082],
  'Mali':                               [17.571,  -3.996],
  'Cameroon':                           [3.848,   11.502],
  'Ghana':                              [7.947,   -1.023],
  'Guinea':                             [11.373, -11.737],
  'Sierra Leone':                       [8.461,  -11.780],
  'Liberia':                            [6.428,   -9.430],
  'Ivory Coast':                        [7.540,   -5.547],
  "Côte d'Ivoire":                      [7.540,   -5.547],
  'Senegal':                            [14.497, -14.452],
  'Mozambique':                         [-18.665, 35.530],
  'Zimbabwe':                           [-19.015, 29.155],
  'Malawi':                             [-13.254, 34.302],
  'Zambia':                             [-13.133, 27.849],
  'Angola':                             [-11.202, 17.874],
  'Tanzania':                           [-6.369,  34.889],
  'Rwanda':                             [-1.940,  29.874],
  'Burundi':                            [-3.373,  29.919],
  'Madagascar':                         [-18.767, 46.869],
  'Cambodia':                           [12.566, 104.991],
  'Indonesia':                          [-0.789, 113.921],
  'Philippines':                        [12.880, 121.774],
  'India':                              [20.594,  78.963],
  'Pakistan':                           [30.375,  69.345],
  'Afghanistan':                        [33.939,  67.710],
  'Bangladesh':                         [23.685,  90.356],
  'Myanmar':                            [21.916,  95.956],
  'Vietnam':                            [14.058, 108.277],
  'Thailand':                           [15.870, 100.993],
  'China':                              [35.862, 104.195],
  'Yemen':                              [15.553,  48.516],
  'Iraq':                               [33.223,  43.679],
  'Syria':                              [34.802,  38.997],
  'Jordan':                             [30.586,  36.238],
  'Lebanon':                            [33.854,  35.862],
  'Saudi Arabia':                       [23.886,  45.079],
  'Iran':                               [32.427,  53.688],
  'Haiti':                              [18.971, -72.285],
  'Brazil':                             [-14.235,-51.925],
  'Peru':                               [-9.190, -75.015],
  'Colombia':                           [4.571,  -74.297],
  'Ecuador':                            [-1.831, -78.183],
  'Bolivia':                            [-16.290, -63.589],
  'Paraguay':                           [-23.443, -58.444],
  'Venezuela':                          [6.424,  -66.590],
  'Mexico':                             [23.634,-102.553],
  'Honduras':                           [15.200, -86.242],
  'Guatemala':                          [15.784, -90.231],
  'Papua New Guinea':                   [-6.315, 143.956],
  'Fiji':                               [-17.713, 178.065],
  'Ukraine':                            [48.379,  31.165],
  'Turkey':                             [38.964,  35.243],
  'Kazakhstan':                         [48.020,  66.924],
};

// Country names sorted longest → shortest to avoid partial matches
const SORTED_COUNTRIES = Object.keys(COUNTRY_COORDS)
  .sort((a, b) => b.length - a.length);

// ─── Country extraction ────────────────────────────────────

/**
 * WHO titles follow patterns like:
 *   "Disease outbreak news: Cholera - Nigeria"
 *   "Mpox - Democratic Republic of the Congo"
 *   "Avian influenza A(H5N1) - Cambodia"
 *
 * Try last segment after " - " first, then scan whole title.
 */
function extractCountry(title: string): string | null {
  // Try " - Country" suffix pattern
  const parts = title.split(' - ');
  if (parts.length >= 2) {
    const candidate = parts[parts.length - 1].trim();
    if (COUNTRY_COORDS[candidate]) return candidate;
  }

  // Fallback: scan entire title for known country names
  const lower = title.toLowerCase();
  for (const country of SORTED_COUNTRIES) {
    if (lower.includes(country.toLowerCase())) return country;
  }

  return null;
}

// ─── Severity ─────────────────────────────────────────────

function whoSeverity(title: string, description: string): Severity {
  const text = (title + ' ' + description).toLowerCase();
  if (/death|fatal|killed/.test(text))          return 'high';
  if (/outbreak|cases|confirmed/.test(text)) {
    const m = text.match(/(\d+)\s*(cases|confirmed|reported|deaths)/);
    if (m && parseInt(m[1], 10) > 100) return 'medium';
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

function guidToId(guid: string): string {
  let h = 0;
  for (let i = 0; i < Math.min(guid.length, 64); i++) {
    h = ((h << 5) - h + guid.charCodeAt(i)) | 0;
  }
  return `who-${Math.abs(h).toString(36)}`;
}

// ─── XML helpers ──────────────────────────────────────────

/** Get text content of a direct child element by tag name */
function getChildText(el: Element, tag: string): string {
  // RSS <link> is unusual — it's a sibling text node, not a child element
  if (tag === 'link') {
    const child = el.querySelector(tag);
    // Some RSS parsers put <link> content as text node after a processing instruction
    if (child) return child.textContent?.trim() ?? '';
    // Fallback: try to find text sibling
    const nodes = el.childNodes;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.nodeType === 1 /* ELEMENT_NODE */ &&
          (node as Element).tagName.toLowerCase() === 'link') {
        return node.textContent?.trim() ?? '';
      }
    }
    return '';
  }
  return el.querySelector(tag)?.textContent?.trim() ?? '';
}

// ─── Main fetch ────────────────────────────────────────────

const WHO_PROXY = '/api/who-rss';

export async function fetchWHOOutbreaks(): Promise<VigilEvent[]> {
  const response = await fetch(WHO_PROXY);

  if (!response.ok) {
    throw new Error(`WHO RSS proxy failed: ${response.status} ${response.statusText}`);
  }

  const xmlText = await response.text();

  if (!xmlText.trim().startsWith('<')) {
    throw new Error('WHO RSS proxy returned non-XML content');
  }

  // Parse XML in the browser
  const parser = new DOMParser();
  const xmlDoc  = parser.parseFromString(xmlText, 'application/xml');

  // Check for parse errors
  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`WHO RSS XML parse error: ${parseError.textContent?.slice(0, 100)}`);
  }

  const items = Array.from(xmlDoc.querySelectorAll('channel > item'));
  const events: VigilEvent[] = [];

  for (const item of items) {
    const title       = getChildText(item, 'title');
    const link        = getChildText(item, 'link');
    const pubDate     = getChildText(item, 'pubDate');
    const description = getChildText(item, 'description');
    const guid        = getChildText(item, 'guid') || link || title;

    if (!title || !isOutbreakItem(title)) continue;

    const country = extractCountry(title);
    if (!country) continue;

    const coords = COUNTRY_COORDS[country];
    if (!coords) continue;

    const [lat, lng] = coords;
    const cleanDesc  = stripHtml(description).slice(0, 300);
    const severity   = whoSeverity(title, cleanDesc);

    // Parse RFC 2822 pubDate ("Mon, 15 Jan 2024 10:30:00 +0000")
    // new Date() handles this natively in all modern browsers
    const timestamp = pubDate
      ? (new Date(pubDate).toISOString() ?? new Date().toISOString())
      : new Date().toISOString();

    // Strip common WHO title prefix
    const cleanTitle = title
      .replace(/^Disease outbreak news:\s*/i, '')
      .trim();

    events.push({
      id:        guidToId(guid),
      timestamp,
      domain:    'health',
      category:  'outbreak',
      severity,
      title:     cleanTitle,
      description: cleanDesc,
      location: {
        lat,
        lng,
        country,
        region: country,
        label:  country,
      },
      source:    'WHO',
      sourceUrl: link || 'https://www.who.int/emergencies/disease-outbreak-news',
      confidence: 0.90,
      tags: [
        'outbreak',
        'who',
        country.toLowerCase().replace(/\s+/g, '-'),
      ],
      metadata: {
        country,
        raw_title: title,
      },
    });
  }

  return events;
}
