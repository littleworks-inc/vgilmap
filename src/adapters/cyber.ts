/**
 * Cyber adapter — proxies through /api/cyber (Vercel edge function).
 * Normalizes ransomware.live victims and CISA Known Exploited Vulnerabilities.
 *
 * "Who was impacted" lives in metadata (victim, sector, country, group) and
 * tags (sector + threat actor) so the sidebar, popup and API can surface it.
 */
import type { VigilEvent, Severity } from '../types';

// ── Country centroids (ISO 3166-1 alpha-2) ─────────────────

const COUNTRY_COORDS: Record<string, [number, number]> = {
  US: [39.8, -98.6], CA: [56.1, -106.3], MX: [23.6, -102.5], BR: [-14.2, -51.9],
  AR: [-38.4, -63.6], CL: [-35.7, -71.5], CO: [4.6, -74.3], PE: [-9.2, -75.0],
  VE: [6.4, -66.6], EC: [-1.8, -78.2], UY: [-32.5, -55.8], PY: [-23.4, -58.4],
  BO: [-16.3, -63.6], CR: [9.7, -83.8], PA: [8.5, -80.8], GT: [15.8, -90.2],
  DO: [18.7, -70.2], PR: [18.2, -66.6], JM: [18.1, -77.3], TT: [10.7, -61.2],
  GB: [54.0, -2.0], IE: [53.4, -8.2], FR: [46.2, 2.2], DE: [51.2, 10.4],
  ES: [40.5, -3.7], PT: [39.4, -8.2], IT: [41.9, 12.6], NL: [52.1, 5.3],
  BE: [50.5, 4.5], LU: [49.8, 6.1], CH: [46.8, 8.2], AT: [47.5, 14.6],
  DK: [56.3, 9.5], SE: [60.1, 18.6], NO: [60.5, 8.5], FI: [61.9, 25.7],
  IS: [64.9, -19.0], PL: [51.9, 19.1], CZ: [49.8, 15.5], SK: [48.7, 19.7],
  HU: [47.2, 19.5], RO: [45.9, 24.9], BG: [42.7, 25.5], GR: [39.1, 21.8],
  HR: [45.1, 15.2], SI: [46.2, 14.9], RS: [44.0, 21.0], BA: [43.9, 17.7],
  AL: [41.2, 20.2], MK: [41.6, 21.7], ME: [42.7, 19.4], EE: [58.6, 25.0],
  LV: [56.9, 24.6], LT: [55.2, 23.9], UA: [48.4, 31.2], BY: [53.7, 27.9],
  MD: [47.4, 28.4], RU: [61.5, 105.3], TR: [38.96, 35.2], CY: [35.1, 33.4],
  MT: [35.9, 14.4], IL: [31.0, 34.9], PS: [31.9, 35.2], LB: [33.9, 35.9],
  JO: [30.6, 36.2], SA: [23.9, 45.1], AE: [23.4, 53.8], QA: [25.4, 51.2],
  KW: [29.3, 47.5], BH: [26.0, 50.6], OM: [21.5, 55.9], IQ: [33.2, 43.7],
  IR: [32.4, 53.7], SY: [34.8, 39.0], YE: [15.6, 48.5], EG: [26.8, 30.8],
  MA: [31.8, -7.1], DZ: [28.0, 1.7], TN: [33.9, 9.5], LY: [26.3, 17.2],
  NG: [9.1, 8.7], GH: [7.9, -1.0], KE: [-0.02, 37.9], ET: [9.1, 40.5],
  TZ: [-6.4, 34.9], UG: [1.4, 32.3], ZA: [-30.6, 22.9], ZW: [-19.0, 29.2],
  ZM: [-13.1, 27.8], SN: [14.5, -14.5], CI: [7.5, -5.5], CM: [7.4, 12.4],
  AO: [-11.2, 17.9], MU: [-20.3, 57.6], NA: [-22.96, 18.5], BW: [-22.3, 24.7],
  IN: [20.6, 78.96], PK: [30.4, 69.3], BD: [23.7, 90.4], LK: [7.9, 80.8],
  NP: [28.4, 84.1], AF: [33.9, 67.7], KZ: [48.0, 66.9], UZ: [41.4, 64.6],
  CN: [35.9, 104.2], HK: [22.3, 114.2], TW: [23.7, 121.0], JP: [36.2, 138.3],
  KR: [35.9, 127.8], KP: [40.3, 127.5], MN: [46.9, 103.8], TH: [15.9, 100.99],
  VN: [14.1, 108.3], MY: [4.2, 101.98], SG: [1.35, 103.8], ID: [-0.8, 113.9],
  PH: [12.9, 121.8], KH: [12.6, 104.99], MM: [21.9, 95.96], AU: [-25.3, 133.8],
  NZ: [-40.9, 174.9], FJ: [-17.7, 178.1], PG: [-6.3, 143.96],
};

const WORLD_FALLBACK: [number, number] = [0, 0];

/** Deterministic hash → [0,1) so repeated loads place the same event in the same spot. */
function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function jitter(id: string, spread: number): [number, number] {
  return [(hash01(id, 1) - 0.5) * spread, (hash01(id, 2) - 0.5) * spread];
}

const regionNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; }
})();

function countryName(code: string): string {
  try { return regionNames?.of(code) ?? code; } catch { return code; }
}

// ── Ransomware victims ─────────────────────────────────────

interface RansomVictim {
  victim?: string;
  group?: string;
  country?: string;
  activity?: string;
  attackdate?: string;
  discovered?: string;
  description?: string;
  domain?: string;
  url?: string;
}

// Sectors where an outage endangers people or critical services.
const CRITICAL_SECTORS = new Set([
  'healthcare', 'energy', 'government', 'public sector', 'transportation',
  'telecommunication', 'utilities', 'emergency services', 'education',
]);

function ransomSeverity(sector: string): Severity {
  const s = sector.toLowerCase();
  if (s === 'healthcare' || s === 'energy' || s === 'emergency services') return 'critical';
  if (CRITICAL_SECTORS.has(s)) return 'high';
  return 'medium';
}

function normalizeVictims(data: unknown): VigilEvent[] {
  if (!Array.isArray(data)) return [];
  const events: VigilEvent[] = [];

  for (const v of data as RansomVictim[]) {
    if (!v.victim || !v.group) continue;
    const code = (v.country ?? '').toUpperCase();
    const [baseLat, baseLng] = COUNTRY_COORDS[code] ?? WORLD_FALLBACK;
    const id = `cyber-ransom-${v.group}-${v.victim}-${v.attackdate ?? v.discovered ?? ''}`;
    const [dLat, dLng] = jitter(id, code === 'US' || code === 'RU' || code === 'CA' ? 10 : 3);
    const sector = v.activity && v.activity !== 'Not Found' ? v.activity : 'Unknown';
    const country = code ? countryName(code) : 'Unknown';

    events.push({
      id,
      timestamp: v.attackdate ?? v.discovered ?? new Date().toISOString(),
      domain: 'cyber',
      category: 'ransomware',
      severity: ransomSeverity(sector),
      title: `Ransomware: ${v.victim} (${country})`,
      description:
        `${v.group} ransomware group claimed ${v.victim}` +
        `${sector !== 'Unknown' ? ` — ${sector} sector` : ''}. ` +
        (v.description ? v.description.slice(0, 200) : ''),
      location: {
        lat: baseLat + dLat,
        lng: baseLng + dLng,
        country: code,
        region: country,
        label: country,
      },
      source: 'ransomware.live',
      sourceUrl: v.url ?? 'https://www.ransomware.live',
      confidence: 0.8, // leak-site claims, not victim-confirmed
      tags: ['ransomware', sector.toLowerCase(), v.group.toLowerCase()],
      metadata: {
        victim: v.victim,
        sector,
        group: v.group,
        country,
        countryCode: code,
        domain: v.domain,
      },
    });
  }
  return events;
}

// ── CISA KEV ───────────────────────────────────────────────

interface KevEntry {
  cveID: string;
  vendorProject?: string;
  product?: string;
  vulnerabilityName?: string;
  dateAdded?: string;
  shortDescription?: string;
  knownRansomwareCampaignUse?: string;
}

function normalizeKev(data: unknown): VigilEvent[] {
  if (!Array.isArray(data)) return [];
  return (data as KevEntry[]).map(v => {
    const id = `cyber-kev-${v.cveID}`;
    const ransomware = v.knownRansomwareCampaignUse === 'Known';
    // KEV is global with no geography: scatter deterministically in the mid-Atlantic
    // so each CVE stays individually clickable instead of stacking on one point.
    const [dLat, dLng] = jitter(id, 24);
    return {
      id,
      timestamp: v.dateAdded ? `${v.dateAdded}T00:00:00Z` : new Date().toISOString(),
      domain: 'cyber',
      category: 'vulnerability',
      severity: ransomware ? 'critical' : 'high',
      title: `${v.cveID}: ${v.vendorProject ?? ''} ${v.product ?? ''}`.trim(),
      description: (v.shortDescription ?? v.vulnerabilityName ?? '').slice(0, 300),
      location: { lat: 15 + dLat, lng: -35 + dLng, country: 'Global', region: 'Cyberspace', label: 'Global (no fixed location)' },
      source: 'CISA KEV',
      sourceUrl: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
      confidence: 0.99, // CISA only lists vulnerabilities with confirmed exploitation
      tags: ['vulnerability', 'actively-exploited', ...(ransomware ? ['ransomware-linked'] : []), (v.vendorProject ?? '').toLowerCase()].filter(Boolean),
      metadata: {
        cve: v.cveID,
        vendor: v.vendorProject,
        product: v.product,
        ransomwareUse: ransomware,
      },
    } satisfies VigilEvent;
  });
}

// ── Main export ───────────────────────────────────────────

export async function fetchCyber(): Promise<VigilEvent[]> {
  try {
    const res = await fetch('/api/cyber');
    if (!res.ok) throw new Error(`/api/cyber ${res.status}`);
    const { victims, kev } = await res.json();
    return [...normalizeVictims(victims), ...normalizeKev(kev)].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  } catch (err) {
    console.warn('[Cyber]', err);
    return [];
  }
}
