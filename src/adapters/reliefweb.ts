/**
 * ReliefWeb adapter — UN OCHA humanitarian crisis database
 * Covers food insecurity, displacement, economic shocks, labor crises.
 * Free JSON API, no key required, proxied through edge function.
 */
import type { VigilEvent, Severity } from '../types';

const COUNTRY_COORDS: Record<string, [number, number]> = {
  'Afghanistan': [33.9, 67.7], 'Ethiopia': [9.1, 40.5],
  'Yemen': [15.6, 48.5], 'Syria': [34.8, 38.9],
  'Somalia': [5.2, 46.2], 'Sudan': [12.9, 30.2],
  'South Sudan': [6.9, 31.3], 'DR Congo': [-4.0, 21.8],
  'Democratic Republic of the Congo': [-4.0, 21.8],
  'Haiti': [18.9, -72.3], 'Nigeria': [9.1, 8.7],
  'Mali': [17.6, -4.0], 'Burkina Faso': [12.4, -1.5],
  'Niger': [17.6, 8.1], 'Chad': [15.5, 18.7],
  'Mozambique': [-18.7, 35.5], 'Zimbabwe': [-20.0, 30.0],
  'Venezuela': [6.4, -66.6], 'Myanmar': [21.9, 96.0],
  'Ukraine': [48.4, 31.2], 'Pakistan': [30.4, 69.3],
  'Bangladesh': [23.7, 90.4], 'Kenya': [-0.0, 37.9],
  'Uganda': [1.4, 32.3], 'Cameroon': [3.8, 11.5],
  'Central African Republic': [6.6, 20.9],
  'Libya': [26.3, 17.2], 'Lebanon': [33.9, 35.5],
  'Iraq': [33.2, 43.7], 'Gaza': [31.4, 34.3],
  'Philippines': [12.9, 121.8], 'Indonesia': [-0.8, 113.9],
  'Colombia': [4.6, -74.1], 'Honduras': [15.2, -86.2],
  'El Salvador': [13.8, -88.9], 'Guatemala': [15.8, -90.2],
  'Cambodia': [12.6, 104.9], 'Malawi': [-13.3, 34.3],
  'Zambia': [-13.1, 27.8], 'Tanzania': [-6.4, 34.9],
  'Rwanda': [-1.9, 29.9], 'Burundi': [-3.4, 29.9],
  'Eritrea': [15.2, 39.8], 'Senegal': [14.5, -14.5],
  'Ghana': [7.9, -1.0], 'Mauritania': [21.0, -10.9],
  'Morocco': [31.8, -7.1], 'Tunisia': [33.9, 9.5],
  'Egypt': [26.8, 30.8], 'Jordan': [30.6, 36.2],
  'Turkey': [38.9, 35.2], 'Iran': [32.4, 53.7],
  'Bolivia': [-16.3, -63.6], 'Peru': [-9.2, -75.0],
  'Ecuador': [-1.8, -78.2], 'Brazil': [-14.2, -51.9],
  'India': [20.6, 79.0], 'Nepal': [28.4, 84.1],
  'Sri Lanka': [7.9, 80.8], 'Tajikistan': [38.9, 71.3],
  'South Africa': [-30.6, 22.9],
};

function findCoords(text: string): [number, number] | null {
  const keys = Object.keys(COUNTRY_COORDS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (text.includes(k)) return COUNTRY_COORDS[k];
  }
  return null;
}

function hashId(s: string): string {
  let h = 0;
  for (let i = 0; i < Math.min(s.length, 80); i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

const LABOR_KEYWORDS = /strike|protest|worker|labour|labor|wage|union|unemploy|job loss|lay.?off|displacement/i;
const FOOD_KEYWORDS  = /food|famine|hunger|nutrition|starv|malnutrit|crop|harvest/i;

function classifyEvent(title: string, tags: string[]): {
  domain: 'economic' | 'labor';
  category: string;
  severity: Severity;
} {
  const text = title + ' ' + tags.join(' ');
  if (LABOR_KEYWORDS.test(text)) {
    return {
      domain: 'labor',
      category: 'strike',
      severity: /mass|general|national|major/i.test(text) ? 'high' : 'medium',
    };
  }
  if (FOOD_KEYWORDS.test(text)) {
    return {
      domain: 'economic',
      category: 'food-insecurity',
      severity: /famine|catastroph|emergency|critical/i.test(text) ? 'critical'
              : /severe|crisis/i.test(text) ? 'high' : 'medium',
    };
  }
  return {
    domain: 'economic',
    category: 'housing-stress',
    severity: /emergency|crisis|acute/i.test(text) ? 'high' : 'medium',
  };
}

interface RWReport {
  id: number;
  fields: {
    title: string;
    date: { created: string };
    country?: Array<{ name: string }>;
    primary_country?: { name: string };
    source?: Array<{ name: string }>;
    url: string;
    body?: string;
    theme?: Array<{ name: string }>;
  };
}

export async function fetchReliefWeb(): Promise<VigilEvent[]> {
  try {
    const res = await fetch('/api/reliefweb', {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`ReliefWeb proxy ${res.status}`);
    const json = await res.json();
    const events: VigilEvent[] = [];

    for (const report of (json.data ?? []) as RWReport[]) {
      const f = report.fields;
      const title = f.title ?? '';
      if (!title) continue;

      const countryName =
        f.primary_country?.name ??
        f.country?.[0]?.name ??
        '';
      const coords = findCoords(countryName) ?? findCoords(title);
      if (!coords) continue;
      const [lat, lng] = coords;

      const tags = (f.theme ?? []).map(t => t.name.toLowerCase());
      const { domain, category, severity } = classifyEvent(title, tags);
      const sourceName = f.source?.[0]?.name ?? 'ReliefWeb';

      events.push({
        id: `rw-${hashId(f.url ?? String(report.id))}`,
        timestamp: f.date?.created ?? new Date().toISOString(),
        domain,
        category,
        severity,
        title: title.slice(0, 120),
        description: (f.body ?? 'Humanitarian situation report.').slice(0, 300),
        location: {
          lat, lng,
          country: countryName,
          region: countryName,
          label: countryName,
        },
        source: sourceName,
        sourceUrl: f.url ?? 'https://reliefweb.int',
        confidence: 0.85,
        tags: ['humanitarian', domain, ...tags.slice(0, 4)],
        metadata: { country: countryName },
      });
    }

    return events;
  } catch (err) {
    console.warn('[ReliefWeb] failed:', err);
    return [];
  }
}
