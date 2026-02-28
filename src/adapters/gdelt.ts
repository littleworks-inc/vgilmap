/**
 * GDELT GKG Conflict Adapter
 * Uses GDELT's BigQuery-like CSV endpoint — no rate limits, no auth.
 * Falls back to empty array if unavailable.
 */
import type { VigilEvent, Severity } from '../types';
const COUNTRY_COORDS: Record<string, [number, number]> = {
  'AFGHANISTAN':[33.9,67.7],'UKRAINE':[48.4,31.2],'SYRIA':[34.8,38.9],
  'YEMEN':[15.6,48.5],'SOMALIA':[5.2,46.2],'SUDAN':[12.9,30.2],
  'SOUTH SUDAN':[6.9,31.3],'MYANMAR':[21.9,96.0],'IRAQ':[33.2,43.7],
  'NIGERIA':[9.1,8.7],'ETHIOPIA':[9.1,40.5],'MALI':[17.6,-4.0],
  'BURKINA FASO':[12.4,-1.5],'NIGER':[17.6,8.1],'CHAD':[15.5,18.7],
  'LIBYA':[26.3,17.2],'PALESTINE':[31.9,35.2],'HAITI':[18.9,-72.3],
  'COLOMBIA':[4.6,-74.1],'VENEZUELA':[6.4,-66.6],'PAKISTAN':[30.4,69.3],
  'INDIA':[20.6,79.0],'INDONESIA':[-0.8,113.9],'PHILIPPINES':[12.9,121.8],
  'MEXICO':[23.6,-102.5],'BRAZIL':[-14.2,-51.9],'CONGO':[-4.0,21.8],
  'DEMOCRATIC REPUBLIC OF THE CONGO':[-4.0,21.8],
  'CENTRAL AFRICAN REPUBLIC':[6.6,20.9],'CAMEROON':[3.8,11.5],
  'MOZAMBIQUE':[-18.7,35.5],'KENYA':[-0.0,37.9],'UGANDA':[1.4,32.3],
  'ISRAEL':[31.0,35.0],'RUSSIA':[61.5,105.3],'CHINA':[35.9,104.2],
  'UNITED STATES':[37.1,-95.7],'IRAN':[32.4,53.7],'TURKEY':[38.9,35.2],
};
function severityFromTitle(title: string): Severity {
  const t = title.toLowerCase();
  if (/killed|dead|massacre|airstrike|bombing|explosion/.test(t)) return 'high';
  if (/attack|clash|protest|strike|conflict|fighting/.test(t)) return 'medium';
  return 'low';
}
function urlToId(url: string): string {
  let h = 0;
  for (let i = 0; i < Math.min(url.length, 64); i++) {
    h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
// GDELT Doc API via our cached edge function proxy
const GDELT_URL = '/api/gdelt';
interface GDELTArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
  sourcecountry: string;
}
interface GDELTResponse { articles?: GDELTArticle[] }
function seendateToISO(s: string): string {
  const d = s.replace('Z','');
  if (d.length < 15) return new Date().toISOString();
  return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${d.slice(9,11)}:${d.slice(11,13)}:${d.slice(13,15)}Z`;
}
function extractCountry(title: string): [number,number] | null {
  const t = title.toUpperCase();
  for (const [country, coords] of Object.entries(COUNTRY_COORDS)) {
    if (t.includes(country)) return coords;
  }
  return null;
}
export async function fetchGDELT(): Promise<VigilEvent[]> {
  try {
    const res = await fetch(GDELT_URL, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`GDELT fetch failed: ${res.status}`);
    const text = await res.text();
    if (!text || !text.trimStart().startsWith('{')) return [];
    const json: GDELTResponse = JSON.parse(text);
    const events: VigilEvent[] = [];
    for (const article of json.articles ?? []) {
      if (!article.title) continue;
      const coords = extractCountry(article.title);
      if (!coords) continue;
      const [lat, lng] = coords;
      events.push({
        id: `gdelt-${urlToId(article.url)}`,
        timestamp: seendateToISO(article.seendate ?? ''),
        domain: 'conflict',
        category: 'armed-conflict',
        severity: severityFromTitle(article.title),
        title: article.title,
        description: `Reported by ${article.domain}.`,
        location: { lat, lng, country: article.sourcecountry ?? '', region: '', label: article.sourcecountry ?? '' },
        source: 'GDELT',
        sourceUrl: article.url,
        confidence: 0.70,
        tags: ['conflict', 'news'],
        metadata: { domain: article.domain },
      });
    }
    return events;
  } catch (err) {
    console.warn('[GDELT] unavailable:', err);
    return [];
  }
}
