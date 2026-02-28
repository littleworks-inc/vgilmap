/**
 * ProMED Health Adapter via /api/who-rss edge function proxy.
 * Falls back silently to empty array if proxy unavailable.
 */
import type { VigilEvent, Severity } from '../types';
interface ProMEDItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}
interface ProMEDResponse { items?: ProMEDItem[]; error?: string }
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
function extractCountry(title: string): string | null {
  const t = title.toUpperCase();
  for (const country of Object.keys(COUNTRY_COORDS)) {
    if (t.includes(country)) return country;
  }
  return null;
}
function promedSeverity(title: string): Severity {
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
export async function fetchWHOOutbreaks(): Promise<VigilEvent[]> {
  try {
    const res = await fetch('/api/who-rss', { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`ProMED proxy failed: ${res.status}`);
    const json: ProMEDResponse = await res.json();
    if (json.error) throw new Error(json.error);
    const events: VigilEvent[] = [];
    for (const item of json.items ?? []) {
      const country = extractCountry(item.title);
      if (!country) continue;
      const coords = COUNTRY_COORDS[country];
      if (!coords) continue;
      const [lat, lng] = coords;
      events.push({
        id: `promed-${urlToId(item.link)}`,
        timestamp: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        domain: 'health',
        category: 'outbreak',
        severity: promedSeverity(item.title),
        title: item.title.slice(0, 120),
        description: item.description?.slice(0, 300) || 'Disease alert via ProMED.',
        location: { lat, lng, country, region: country, label: country },
        source: 'ProMED/ISID',
        sourceUrl: item.link || 'https://promedmail.org',
        confidence: 0.85,
        tags: ['outbreak', 'health'],
        metadata: { country },
      });
    }
    return events;
  } catch (err) {
    console.warn('[ProMED] unavailable:', err);
    return [];
  }
}
