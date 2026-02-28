/**
 * ProMED Health Adapter — Disease Outbreak Alerts
 *
 * ProMED (Program for Monitoring Emerging Diseases) is the world's
 * largest publicly available infectious disease outbreak monitoring
 * system, operated by ISID. RSS feed via Vercel edge proxy.
 */
import type { VigilEvent, Severity } from '../types';

// ─── Country name extraction ────────────────────────────────

// ProMED titles follow: "DISEASE - COUNTRY (NN): DETAILS"
// or "DISEASE, SUBTYPE - COUNTRY"
function extractCountry(title: string): string | null {
  // Everything after " - " up to " (", ":", or end
  const m = title.match(/\s-\s([A-Z][A-Z ,'.()-]+?)(?:\s*\(\d+\)|\s*:|$)/);
  if (!m) return null;
  // Take first country if comma-separated list
  return m[1].split(',')[0].trim();
}

function extractDisease(title: string): string {
  return (title.split(' - ')[0] ?? title).trim();
}

// ─── Severity ──────────────────────────────────────────────

function promedSeverity(title: string): Severity {
  const t = title.toLowerCase();
  if (/ebola|marburg|plague|hanta|crimean/.test(t))          return 'high';
  if (/cholera|mpox|monkeypox|dengue|measles|rift.valley|avian.influenza|h5n1/.test(t)) return 'medium';
  return 'low';
}

// ─── Country → [lat, lng] ──────────────────────────────────

const COUNTRY_COORDS: Record<string, [number, number]> = {
  'DEMOCRATIC REPUBLIC OF THE CONGO': [-4.0, 21.8],
  'DRC': [-4.0, 21.8], 'CONGO': [-4.0, 21.8],
  'NIGERIA': [9.1, 8.7], 'ETHIOPIA': [9.1, 40.5],
  'SOMALIA': [5.2, 46.2], 'SUDAN': [12.9, 30.2],
  'SOUTH SUDAN': [6.9, 31.3], 'UGANDA': [1.4, 32.3],
  'KENYA': [-0.0, 37.9], 'TANZANIA': [-6.4, 34.9],
  'RWANDA': [-1.9, 29.9], 'CAMEROON': [3.8, 11.5],
  'GUINEA': [11.4, -11.7], 'SIERRA LEONE': [8.5, -11.8],
  'LIBERIA': [6.4, -9.4], 'GHANA': [7.9, -1.0],
  'IVORY COAST': [7.5, -5.5], 'COTE D\'IVOIRE': [7.5, -5.5],
  'MALI': [17.6, -4.0], 'NIGER': [17.6, 8.1],
  'CHAD': [15.5, 18.7], 'BURKINA FASO': [12.4, -1.5],
  'INDIA': [20.6, 79.0], 'PAKISTAN': [30.4, 69.3],
  'BANGLADESH': [23.7, 90.4], 'AFGHANISTAN': [33.9, 67.7],
  'INDONESIA': [-0.8, 113.9], 'PHILIPPINES': [12.9, 121.8],
  'VIETNAM': [14.1, 108.3], 'MYANMAR': [21.9, 96.0],
  'CAMBODIA': [12.6, 104.9], 'THAILAND': [15.9, 100.9],
  'MALAYSIA': [4.2, 108.0], 'CHINA': [35.9, 104.2],
  'HAITI': [18.9, -72.3], 'COLOMBIA': [4.6, -74.1],
  'BRAZIL': [-14.2, -51.9], 'PERU': [-9.2, -75.0],
  'MOZAMBIQUE': [-18.7, 35.5], 'MALAWI': [-13.3, 34.3],
  'ZIMBABWE': [-19.0, 29.2], 'MADAGASCAR': [-18.8, 46.9],
  'ZAMBIA': [-13.1, 27.8], 'ANGOLA': [-11.2, 17.9],
  'USA': [37.1, -95.7], 'UNITED STATES': [37.1, -95.7],
  'MEXICO': [23.6, -102.5], 'CANADA': [56.1, -106.3],
};

// ─── Response types ────────────────────────────────────────

interface ProMEDItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

interface ProMEDResponse {
  items?: ProMEDItem[];
  error?: string;
}

// ─── Main fetch ────────────────────────────────────────────

export async function fetchWHOOutbreaks(): Promise<VigilEvent[]> {
  const res = await fetch('/api/who-rss', {
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`ProMED proxy failed: ${res.status} ${res.statusText}`);
  }

  const json: ProMEDResponse = await res.json();

  if (json.error) {
    throw new Error(`ProMED error: ${json.error}`);
  }

  const events: VigilEvent[] = [];

  for (const item of json.items ?? []) {
    const country = extractCountry(item.title);
    if (!country) continue;

    const coords = COUNTRY_COORDS[country.toUpperCase()];
    if (!coords) continue;

    const [lat, lng] = coords;
    const disease = extractDisease(item.title);
    const timestamp = item.pubDate
      ? new Date(item.pubDate).toISOString()
      : new Date().toISOString();

    events.push({
      id: `promed-${item.link.split('/').pop()?.replace(/\D/g, '').slice(0, 12) ?? Math.random().toString(36).slice(2, 10)}`,
      timestamp,
      domain: 'health',
      category: 'outbreak',
      severity: promedSeverity(item.title),
      title: item.title.slice(0, 120),
      description: item.description || `${disease} alert reported by ProMED.`,
      location: {
        lat,
        lng,
        country,
        region: country,
        label: country,
      },
      source: 'ProMED/ISID',
      sourceUrl: item.link || 'https://promedmail.org',
      confidence: 0.88,
      tags: ['outbreak', 'health', disease.toLowerCase().split(/[\s,/]/)[0]],
      metadata: { disease, country },
    });
  }

  return events;
}
