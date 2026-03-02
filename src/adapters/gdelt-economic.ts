/**
 * GDELT Economic adapter
 * Filters GDELT news stream for economic/labor crisis keywords.
 * Reuses /api/gdelt-economic edge proxy.
 */
import type { VigilEvent, Severity } from '../types';

const ECON_KEYWORDS =
  /sanction|inflation|recession|default|debt crisis|financial crisis|bank run|currency crisis|unemployment surge|mass layoff|strike|worker protest|supply chain/i;

const COUNTRY_COORDS: Record<string, [number, number]> = {
  'ARGENTINA': [-38.4, -63.6], 'TURKEY': [38.9, 35.2],
  'VENEZUELA': [6.4, -66.6], 'PAKISTAN': [30.4, 69.3],
  'NIGERIA': [9.1, 8.7], 'EGYPT': [26.8, 30.8],
  'SRI LANKA': [7.9, 80.8], 'BANGLADESH': [23.7, 90.4],
  'ETHIOPIA': [9.1, 40.5], 'KENYA': [-0.0, 37.9],
  'GHANA': [7.9, -1.0], 'ZAMBIA': [-13.1, 27.8],
  'UKRAINE': [48.4, 31.2], 'RUSSIA': [61.5, 105.3],
  'IRAN': [32.4, 53.7], 'IRAQ': [33.2, 43.7],
  'LEBANON': [33.9, 35.5], 'MYANMAR': [21.9, 96.0],
  'HAITI': [18.9, -72.3], 'CUBA': [21.5, -78.0],
  'COLOMBIA': [4.6, -74.1], 'PERU': [-9.2, -75.0],
  'BOLIVIA': [-16.3, -63.6], 'INDIA': [20.6, 79.0],
  'INDONESIA': [-0.8, 113.9], 'BRAZIL': [-14.2, -51.9],
  'MEXICO': [23.6, -102.5], 'FRANCE': [46.2, 2.2],
  'UNITED KINGDOM': [55.4, -3.4], 'GERMANY': [51.2, 10.4],
  'SOUTH KOREA': [35.9, 127.8], 'JAPAN': [36.2, 138.3],
  'CHINA': [35.9, 104.2], 'UNITED STATES': [37.1, -95.7],
  'SOUTH AFRICA': [-30.6, 22.9], 'ZIMBABWE': [-20.0, 30.0],
  'GREECE': [39.1, 21.8], 'SERBIA': [44.0, 21.0],
};

function extractCountry(text: string): [number, number] | null {
  const t = text.toUpperCase();
  const keys = Object.keys(COUNTRY_COORDS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (t.includes(k)) return COUNTRY_COORDS[k];
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

function severityFromTitle(title: string): Severity {
  const t = title.toLowerCase();
  if (/crisis|collapse|default|emergency|crash|hyperinflation/.test(t)) return 'high';
  if (/sanction|protest|strike|surge|inflation/.test(t)) return 'medium';
  return 'low';
}

function domainFromTitle(title: string): 'economic' | 'labor' {
  return /strike|protest|worker|union|layoff|unemploy/.test(title.toLowerCase())
    ? 'labor'
    : 'economic';
}

interface GDELTArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
  sourcecountry: string;
}

function seendateToISO(s: string): string {
  if (!s || s.length < 8) return new Date().toISOString();
  const d = s.replace('Z', '');
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T` +
    `${d.slice(9, 11) || '00'}:${d.slice(11, 13) || '00'}:00Z`;
}

export async function fetchGDELTEconomic(): Promise<VigilEvent[]> {
  try {
    const res = await fetch('/api/gdelt-economic');
    if (!res.ok) throw new Error(`gdelt-economic proxy ${res.status}`);
    const json = await res.json();
    const events: VigilEvent[] = [];
    const seen = new Set<string>();

    for (const a of (json.articles ?? []) as GDELTArticle[]) {
      if (!a.title || !ECON_KEYWORDS.test(a.title)) continue;
      const coords = extractCountry(a.title + ' ' + (a.sourcecountry ?? ''));
      if (!coords) continue;
      const [lat, lng] = coords;

      const id = `gdelt-econ-${hashId(a.url ?? a.title)}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const domain = domainFromTitle(a.title);
      events.push({
        id,
        timestamp: seendateToISO(a.seendate),
        domain,
        category: domain === 'labor' ? 'strike' : 'unemployment',
        severity: severityFromTitle(a.title),
        title: a.title.slice(0, 120),
        description: `Reported by ${a.domain ?? 'news source'}.`,
        location: {
          lat, lng,
          country: a.sourcecountry ?? '',
          region: '',
          label: a.sourcecountry ?? '',
        },
        source: 'GDELT Economic',
        sourceUrl: a.url ?? '',
        confidence: 0.65,
        tags: [domain, 'news', 'gdelt'],
        metadata: {},
      });
    }

    return events;
  } catch (err) {
    console.warn('[GDELT Economic] failed:', err);
    return [];
  }
}
