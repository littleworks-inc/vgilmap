/**
 * Conflict Adapter — Multi-source via Vercel edge proxies
 *
 * Source 1: GDELT Doc API  → /api/gdelt        (with retry logic)
 * Source 2: News RSS feeds → /api/conflict-rss  (BBC, DW, Guardian)
 *
 * Both run server-side via edge functions — no CORS, no auth needed.
 * Results merge and deduplicate. Either source failing is silent.
 */
import type { VigilEvent, Severity } from '../types';
// ─── Shared helpers ────────────────────────────────────────
function hashId(s: string): string {
  let h = 0;
  for (let i = 0; i < Math.min(s.length, 80); i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
function severityFromTitle(title: string): Severity {
  const t = title.toLowerCase();
  if (/killed|dead|massacre|airstrike|bombing|explosion/.test(t)) return 'high';
  if (/attack|clash|conflict|fighting|troops|offensive/.test(t)) return 'medium';
  return 'low';
}
function seendateToISO(s: string): string {
  if (!s || s.length < 8) return new Date().toISOString();
  const d = s.replace('Z', '');
  return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T` +
    `${d.slice(9,11) || '00'}:${d.slice(11,13) || '00'}:00Z`;
}
// ─── Country coordinate lookup ─────────────────────────────
const COUNTRY_COORDS: Record<string, [number, number]> = {
  'AFGHANISTAN':[33.9,67.7],'UKRAINE':[48.4,31.2],'RUSSIA':[61.5,105.3],
  'SYRIA':[34.8,38.9],'YEMEN':[15.6,48.5],'SOMALIA':[5.2,46.2],
  'SUDAN':[12.9,30.2],'SOUTH SUDAN':[6.9,31.3],'MYANMAR':[21.9,96.0],
  'IRAQ':[33.2,43.7],'NIGERIA':[9.1,8.7],'ETHIOPIA':[9.1,40.5],
  'MALI':[17.6,-4.0],'BURKINA FASO':[12.4,-1.5],'NIGER':[17.6,8.1],
  'CHAD':[15.5,18.7],'LIBYA':[26.3,17.2],'PALESTINE':[31.9,35.2],
  'GAZA':[31.4,34.3],'ISRAEL':[31.0,35.0],'HAITI':[18.9,-72.3],
  'COLOMBIA':[4.6,-74.1],'VENEZUELA':[6.4,-66.6],'PAKISTAN':[30.4,69.3],
  'INDIA':[20.6,79.0],'INDONESIA':[-0.8,113.9],'PHILIPPINES':[12.9,121.8],
  'IRAN':[32.4,53.7],'TURKEY':[38.9,35.2],'MEXICO':[23.6,-102.5],
  'DEMOCRATIC REPUBLIC OF THE CONGO':[-4.0,21.8],'CONGO':[-4.0,21.8],
  'CENTRAL AFRICAN REPUBLIC':[6.6,20.9],'CAMEROON':[3.8,11.5],
  'MOZAMBIQUE':[-18.7,35.5],'KENYA':[-0.0,37.9],'UGANDA':[1.4,32.3],
  'SAUDI ARABIA':[23.9,45.1],'EGYPT':[26.8,30.8],'LEBANON':[33.9,35.5],
  'SERBIA':[44.0,21.0],'KOSOVO':[42.6,20.9],'GEORGIA':[42.3,43.4],
  'AZERBAIJAN':[40.1,47.6],'ARMENIA':[40.1,45.0],'BANGLADESH':[23.7,90.4],
  'BRAZIL':[-14.2,-51.9],'ECUADOR':[-1.8,-78.2],'PERU':[-9.2,-75.0],
  'HONDURAS':[15.2,-86.2],'EL SALVADOR':[13.8,-88.9],
};
function extractCountry(text: string): [number, number] | null {
  const t = text.toUpperCase();
  // Longest match first prevents "CONGO" matching before "DEMOCRATIC REPUBLIC OF THE CONGO"
  const keys = Object.keys(COUNTRY_COORDS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (t.includes(key)) return COUNTRY_COORDS[key];
  }
  return null;
}
// ─── Source 1: GDELT via edge proxy ───────────────────────
interface GDELTArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
  sourcecountry: string;
}
async function fromGDELT(): Promise<VigilEvent[]> {
  const res = await fetch('/api/gdelt');
  if (!res.ok) throw new Error(`gdelt proxy ${res.status}`);
  const json = await res.json();
  const events: VigilEvent[] = [];
  for (const a of (json.articles ?? []) as GDELTArticle[]) {
    if (!a.title) continue;
    const coords = extractCountry(a.title);
    if (!coords) continue;
    const [lat, lng] = coords;
    events.push({
      id: `gdelt-${hashId(a.url ?? a.title)}`,
      timestamp: seendateToISO(a.seendate),
      domain: 'conflict',
      category: 'armed-conflict',
      severity: severityFromTitle(a.title),
      title: a.title,
      description: `Reported by ${a.domain ?? 'news source'}.`,
      location: { lat, lng, country: a.sourcecountry ?? '', region: '', label: a.sourcecountry ?? '' },
      source: 'GDELT',
      sourceUrl: a.url,
      confidence: 0.70,
      tags: ['conflict', 'news'],
      metadata: {},
    });
  }
  return events;
}
// ─── Source 2: RSS feeds via edge proxy ───────────────────
async function fromRSS(): Promise<VigilEvent[]> {
  const res = await fetch('/api/conflict-rss');
  if (!res.ok) throw new Error(`rss proxy ${res.status}`);
  const json = await res.json();
  const events: VigilEvent[] = [];
  for (const item of json.items ?? []) {
    if (!item.title) continue;
    const coords = extractCountry(item.title + ' ' + (item.description ?? ''));
    if (!coords) continue;
    const [lat, lng] = coords;
    events.push({
      id: `rss-${hashId(item.link ?? item.title)}`,
      timestamp: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      domain: 'conflict',
      category: 'armed-conflict',
      severity: severityFromTitle(item.title),
      title: item.title.slice(0, 120),
      description: item.description || 'News report.',
      location: { lat, lng, country: '', region: '', label: '' },
      source: 'News RSS',
      sourceUrl: item.link ?? '',
      confidence: 0.65,
      tags: ['conflict', 'news', 'rss'],
      metadata: {},
    });
  }
  return events;
}
// ─── Main export ───────────────────────────────────────────
export async function fetchGDELT(): Promise<VigilEvent[]> {
  const [gdeltResult, rssResult] = await Promise.allSettled([
    fromGDELT(),
    fromRSS(),
  ]);
  const all: VigilEvent[] = [];
  if (gdeltResult.status === 'fulfilled') {
    all.push(...gdeltResult.value);
  } else {
    console.warn('[GDELT proxy] failed:', gdeltResult.reason?.message);
  }
  if (rssResult.status === 'fulfilled') {
    all.push(...rssResult.value);
  } else {
    console.warn('[RSS proxy] failed:', rssResult.reason?.message);
  }
  // Deduplicate
  const seen = new Set<string>();
  return all.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}
