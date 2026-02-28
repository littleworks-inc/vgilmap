/**
 * WHO Disease Outbreak News Adapter
 * Fetches WHO's public RSS feed directly — CORS-enabled, no proxy needed.
 * Falls back silently to empty array if unavailable.
 */
import type { VigilEvent, Severity } from '../types';

const COUNTRY_COORDS: Record<string, [number, number]> = {
  'CONGO': [-4.0, 21.8], 'DRC': [-4.0, 21.8], 'NIGERIA': [9.1, 8.7],
  'ETHIOPIA': [9.1, 40.5], 'SOMALIA': [5.2, 46.2], 'SUDAN': [12.9, 30.2],
  'UGANDA': [1.4, 32.3], 'KENYA': [-0.0, 37.9], 'TANZANIA': [-6.4, 34.9],
  'CAMEROON': [3.8, 11.5], 'GUINEA': [11.4, -11.7], 'INDIA': [20.6, 79.0],
  'PAKISTAN': [30.4, 69.3], 'BANGLADESH': [23.7, 90.4],
  'INDONESIA': [-0.8, 113.9], 'PHILIPPINES': [12.9, 121.8],
  'VIETNAM': [14.1, 108.3], 'MYANMAR': [21.9, 96.0], 'HAITI': [18.9, -72.3],
  'BRAZIL': [-14.2, -51.9], 'PERU': [-9.2, -75.0], 'COLOMBIA': [4.6, -74.1],
  'CHINA': [35.9, 104.2], 'USA': [37.1, -95.7], 'UNITED STATES': [37.1, -95.7],
  'MEXICO': [23.6, -102.5], 'MADAGASCAR': [-18.8, 46.9], 'MALAWI': [-13.3, 34.3],
  'CHAD': [15.5, 18.7], 'NIGER': [17.6, 8.1], 'MALI': [17.6, -4.0],
};

const DISEASE_KEYWORDS = /ebola|marburg|plague|cholera|mpox|dengue|measles|outbreak|epidemic|polio|lassa|typhoid|influenza|avian|rabies|anthrax/i;

function extractCountry(title: string): string | null {
  const t = title.toUpperCase();
  for (const country of Object.keys(COUNTRY_COORDS)) {
    if (t.includes(country)) return country;
  }
  return null;
}

function whoSeverity(title: string): Severity {
  const t = title.toLowerCase();
  if (/ebola|marburg|plague|cholera/.test(t)) return 'high';
  if (/mpox|dengue|measles|outbreak/.test(t)) return 'medium';
  return 'low';
}

function urlToId(url: string): string {
  let h = 0;
  for (let i = 0; i < Math.min(url.length, 64); i++) {
    h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`,
    'i'
  );
  const m = xml.match(re);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

// WHO Disease Outbreak News RSS — CORS-enabled, direct browser fetch
const WHO_RSS_URL = 'https://www.who.int/rss-feeds/news-english.xml';

export async function fetchWHOOutbreaks(): Promise<VigilEvent[]> {
  try {
    const res = await fetch(WHO_RSS_URL, { headers: { 'Accept': 'application/rss+xml, application/xml, text/xml, */*' } });
    if (!res.ok) throw new Error(`WHO RSS returned ${res.status}`);
    const xml = await res.text();
    const events: VigilEvent[] = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const chunk = m[1];
      const title = extractTag(chunk, 'title');
      if (!title || !DISEASE_KEYWORDS.test(title)) continue;
      const country = extractCountry(title);
      if (!country) continue;
      const coords = COUNTRY_COORDS[country];
      if (!coords) continue;
      const [lat, lng] = coords;
      const link = extractTag(chunk, 'link');
      const pubDate = extractTag(chunk, 'pubDate');
      const description = extractTag(chunk, 'description').slice(0, 300);
      events.push({
        id: `who-${urlToId(link || title)}`,
        timestamp: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        domain: 'health',
        category: 'outbreak',
        severity: whoSeverity(title),
        title: title.slice(0, 120),
        description: description || 'Disease alert via WHO.',
        location: { lat, lng, country, region: country, label: country },
        source: 'WHO',
        sourceUrl: link || 'https://www.who.int/emergencies/disease-outbreak-news',
        confidence: 0.90,
        tags: ['outbreak', 'health'],
        metadata: { country },
      });
    }
    return events;
  } catch (err) {
    console.warn('[WHO] unavailable:', err);
    return [];
  }
}
