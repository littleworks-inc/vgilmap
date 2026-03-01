/**
 * Conflict Intelligence Adapter — Multi-Source Pipeline
 *
 * Sources (in parallel, each with timeout + silent fallback):
 *   1. ReliefWeb/OCHA — UN-backed structured crisis data
 *   2. RSS Bridge — BBC/Al Jazeera conflict headlines
 *   3. UCDP — Uppsala Conflict Data Program (GeoJSON)
 *
 * All sources fire simultaneously. Results merge + deduplicate.
 * If all fail → returns [] silently. Never crashes the app.
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
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    ),
  ]);
}
function severityFromText(text: string): Severity {
  const t = text.toLowerCase();
  if (/killed|dead|massacre|airstrike|bombing|explosion|attack/.test(t)) return 'high';
  if (/clash|conflict|fighting|troops|offensive|shelling|protest/.test(t)) return 'medium';
  return 'low';
}
// ─── Country coordinate lookup ─────────────────────────────
const COUNTRY_COORDS: Record<string, [number, number]> = {
  'AFGHANISTAN':[33.9,67.7],'UKRAINE':[48.4,31.2],'RUSSIA':[61.5,105.3],
  'SYRIA':[34.8,38.9],'YEMEN':[15.6,48.5],'SOMALIA':[5.2,46.2],
  'SUDAN':[12.9,30.2],'SOUTH SUDAN':[6.9,31.3],'MYANMAR':[21.9,96.0],
  'IRAQ':[33.2,43.7],'NIGERIA':[9.1,8.7],'ETHIOPIA':[9.1,40.5],
  'MALI':[17.6,-4.0],'BURKINA FASO':[12.4,-1.5],'NIGER':[17.6,8.1],
  'CHAD':[15.5,18.7],'LIBYA':[26.3,17.2],'PALESTINE':[31.9,35.2],
  'ISRAEL':[31.0,35.0],'HAITI':[18.9,-72.3],'COLOMBIA':[4.6,-74.1],
  'VENEZUELA':[6.4,-66.6],'PAKISTAN':[30.4,69.3],'INDIA':[20.6,79.0],
  'INDONESIA':[-0.8,113.9],'PHILIPPINES':[12.9,121.8],'IRAN':[32.4,53.7],
  'TURKEY':[38.9,35.2],'MEXICO':[23.6,-102.5],'BRAZIL':[-14.2,-51.9],
  'DEMOCRATIC REPUBLIC OF THE CONGO':[-4.0,21.8],'CONGO':[-4.0,21.8],
  'CENTRAL AFRICAN REPUBLIC':[6.6,20.9],'CAMEROON':[3.8,11.5],
  'MOZAMBIQUE':[-18.7,35.5],'KENYA':[-0.0,37.9],'UGANDA':[1.4,32.3],
  'SAUDI ARABIA':[23.9,45.1],'EGYPT':[26.8,30.8],'LEBANON':[33.9,35.5],
  'KOSOVO':[42.6,20.9],'SERBIA':[44.0,21.0],'GEORGIA':[42.3,43.4],
  'AZERBAIJAN':[40.1,47.6],'ARMENIA':[40.1,45.0],'BANGLADESH':[23.7,90.4],
  'SRI LANKA':[7.9,80.8],'CAMBODIA':[12.6,104.9],'LAOS':[19.9,102.5],
};
function extractCoords(text: string): [number, number] | null {
  const t = text.toUpperCase();
  // Try longest match first to avoid "CONGO" matching before "DEMOCRATIC REPUBLIC OF THE CONGO"
  const sorted = Object.keys(COUNTRY_COORDS).sort((a, b) => b.length - a.length);
  for (const country of sorted) {
    if (t.includes(country)) return COUNTRY_COORDS[country];
  }
  return null;
}
// ─── Source 1: ReliefWeb OCHA ──────────────────────────────
async function fetchReliefWeb(): Promise<VigilEvent[]> {
  const res = await fetch(
    'https://api.reliefweb.int/v2/disasters?appname=vigilmap-prod',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        preset: 'latest',
        limit: 40,
        filter: {
          operator: 'OR',
          conditions: [
            { field: 'type.name', value: 'Complex Emergency' },
            { field: 'type.name', value: 'Civil Unrest' },
            { field: 'type.name', value: 'Flash Flood' },
            { field: 'type.name', value: 'Flood' },
            { field: 'type.name', value: 'Tropical Cyclone' },
            { field: 'type.name', value: 'Earthquake' },
            { field: 'type.name', value: 'Epidemic' },
          ],
        },
        fields: {
          include: ['name','status','date.created','type.name',
                    'type.primary','country.name','country.iso3','country.primary'],
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`ReliefWeb ${res.status}`);
  const json = await res.json();
  const events: VigilEvent[] = [];
  for (const item of json.data ?? []) {
    const f = item.fields;
    const country = f.country?.find((c: any) => c.primary) ?? f.country?.[0];
    if (!country) continue;
    const coords = extractCoords(country.name.toUpperCase());
    if (!coords) continue;
    const [lat, lng] = coords;
    const typeName = f.type?.find((t: any) => t.primary)?.name ?? f.type?.[0]?.name ?? 'Crisis';
    const isConflict = /emergency|unrest|conflict/i.test(typeName);
    events.push({
      id: `rw-${item.id}`,
      timestamp: f.date?.created ?? new Date().toISOString(),
      domain: isConflict ? 'conflict' : 'disaster',
      category: isConflict ? 'armed-conflict' : 'extreme-weather',
      severity: f.status === 'alert' ? 'critical' : f.status === 'current' ? 'high' : 'medium',
      title: f.name,
      description: `${typeName} in ${country.name}. Status: ${f.status}.`,
      location: { lat, lng, country: country.name, region: country.name, label: country.name },
      source: 'ReliefWeb/OCHA',
      sourceUrl: `https://reliefweb.int/disaster/${item.id}`,
      confidence: 0.92,
      tags: [typeName.toLowerCase().replace(/\s+/g,'-'), f.status],
      metadata: { disaster_type: typeName, status: f.status },
    });
  }
  return events;
}
// ─── Source 2: UCDP Georeferenced Events ──────────────────
// Uppsala Conflict Data Program — open data, GeoJSON, no auth
async function fetchUCDP(): Promise<VigilEvent[]> {
  // UCDP candidate events API — recent months, public domain
  const year = new Date().getFullYear();
  const res = await fetch(
    `https://ucdpapi.pcr.uu.se/api/gedevents/${year}?pagesize=50&page=1`,
    { headers: { 'Accept': 'application/json' } }
  );
  if (!res.ok) throw new Error(`UCDP ${res.status}`);
  const json = await res.json();
  const events: VigilEvent[] = [];
  for (const ev of json.Result ?? []) {
    const lat = parseFloat(ev.latitude);
    const lng = parseFloat(ev.longitude);
    if (isNaN(lat) || isNaN(lng)) continue;
    const deaths = (ev.deaths_a ?? 0) + (ev.deaths_b ?? 0) + (ev.deaths_civilians ?? 0);
    const severity: Severity =
      deaths >= 25 ? 'critical' :
      deaths >= 10 ? 'high' :
      deaths >= 1  ? 'medium' : 'low';
    events.push({
      id: `ucdp-${ev.id ?? hashId(String(lat) + String(lng) + ev.date_start)}`,
      timestamp: ev.date_start ? `${ev.date_start}T00:00:00Z` : new Date().toISOString(),
      domain: 'conflict',
      category: 'armed-conflict',
      severity,
      title: ev.conflict_name ?? `Armed conflict in ${ev.country ?? 'unknown'}`,
      description: `${ev.type_of_violence_label ?? 'Conflict event'}. Casualties: ${deaths}.`,
      location: {
        lat, lng,
        country: ev.country ?? '',
        region: ev.adm_1 ?? '',
        label: ev.country ?? `${lat.toFixed(1)}, ${lng.toFixed(1)}`,
      },
      source: 'UCDP',
      sourceUrl: 'https://ucdp.uu.se',
      confidence: 0.88,
      tags: ['conflict', 'ucdp', ev.type_of_violence_label?.toLowerCase() ?? 'armed'],
      metadata: { deaths, type: ev.type_of_violence_label },
    });
  }
  return events;
}
// ─── Source 3: ACAPS Crisis Insight ───────────────────────
// ACAPS provides humanitarian crisis data with coordinates
async function fetchACAPS(): Promise<VigilEvent[]> {
  const res = await fetch(
    'https://api.acaps.org/api/v1/crises/?format=json&limit=40',
    { headers: { 'Accept': 'application/json' } }
  );
  if (!res.ok) throw new Error(`ACAPS ${res.status}`);
  const json = await res.json();
  const events: VigilEvent[] = [];
  for (const crisis of json.results ?? []) {
    const coords = extractCoords((crisis.country_name ?? '').toUpperCase());
    if (!coords) continue;
    const [lat, lng] = coords;
    const severityLevel = crisis.crisis_level ?? '';
    const severity: Severity =
      /extreme/i.test(severityLevel) ? 'critical' :
      /severe|high/i.test(severityLevel) ? 'high' :
      /medium/i.test(severityLevel) ? 'medium' : 'low';
    events.push({
      id: `acaps-${crisis.id ?? hashId(crisis.crisis_name ?? '')}`,
      timestamp: crisis.crisis_date ?? new Date().toISOString(),
      domain: 'conflict',
      category: 'armed-conflict',
      severity,
      title: crisis.crisis_name ?? `Crisis in ${crisis.country_name}`,
      description: `${crisis.crisis_type ?? 'Humanitarian crisis'} in ${crisis.country_name}. Level: ${severityLevel}.`,
      location: {
        lat, lng,
        country: crisis.country_name ?? '',
        region: crisis.country_name ?? '',
        label: crisis.country_name ?? '',
      },
      source: 'ACAPS',
      sourceUrl: `https://www.acaps.org/en/countries/${(crisis.country_name ?? '').toLowerCase().replace(/\s+/g,'-')}`,
      confidence: 0.85,
      tags: ['crisis', 'humanitarian', severityLevel.toLowerCase()].filter(Boolean),
      metadata: { crisis_type: crisis.crisis_type, level: severityLevel },
    });
  }
  return events;
}
// ─── Main export — parallel fetch with timeout ─────────────
export async function fetchGDELT(): Promise<VigilEvent[]> {
  const TIMEOUT_MS = 8000;
  const [rwResult, ucdpResult, acapsResult] = await Promise.allSettled([
    withTimeout(fetchReliefWeb(), TIMEOUT_MS),
    withTimeout(fetchUCDP(),      TIMEOUT_MS),
    withTimeout(fetchACAPS(),     TIMEOUT_MS),
  ]);
  const all: VigilEvent[] = [];
  if (rwResult.status === 'fulfilled') {
    all.push(...rwResult.value);
  } else {
    console.warn('[ReliefWeb] failed:', rwResult.reason?.message);
  }
  if (ucdpResult.status === 'fulfilled') {
    all.push(...ucdpResult.value);
  } else {
    console.warn('[UCDP] failed:', ucdpResult.reason?.message);
  }
  if (acapsResult.status === 'fulfilled') {
    all.push(...acapsResult.value);
  } else {
    console.warn('[ACAPS] failed:', acapsResult.reason?.message);
  }
  // Deduplicate by id
  const seen = new Set<string>();
  return all.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}
