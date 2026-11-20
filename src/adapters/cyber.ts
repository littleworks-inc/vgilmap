/**
 * Cyber adapter — proxies through /api/cyber (Vercel edge function).
 * Normalizes ransomware.live victims and CISA Known Exploited Vulnerabilities.
 *
 * "Who was impacted" lives in metadata (victim, sector, country, group) and
 * tags (sector + threat actor) so the sidebar, popup and API can surface it.
 */
import type { VigilEvent, Severity } from '../types';
import { addWarning } from './source-warnings';
import { COUNTRY_COORDS, countryName } from './countries';

// ── Country centroids come from the shared ./countries module ──

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
    return {
      id,
      timestamp: v.dateAdded ? `${v.dateAdded}T00:00:00Z` : new Date().toISOString(),
      domain: 'cyber',
      category: 'vulnerability',
      severity: ransomware ? 'critical' : 'high',
      title: `${v.cveID}: ${v.vendorProject ?? ''} ${v.product ?? ''}`.trim(),
      description: (v.shortDescription ?? v.vulnerabilityName ?? '').slice(0, 300),
      // KEV is global: there is no honest map position, so it is flagged `unlocated` and kept off the map.
      location: { lat: 0, lng: 0, country: 'Global', region: 'Cyberspace', label: 'Global — no map location' },
      source: 'CISA KEV',
      sourceUrl: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
      confidence: 0.99, // CISA only lists vulnerabilities with confirmed exploitation
      tags: ['vulnerability', 'actively-exploited', ...(ransomware ? ['ransomware-linked'] : []), (v.vendorProject ?? '').toLowerCase()].filter(Boolean),
      metadata: {
        cve: v.cveID,
        vendor: v.vendorProject,
        product: v.product,
        ransomwareUse: ransomware,
        unlocated: true,
      },
    } satisfies VigilEvent;
  });
}

// ── Main export ───────────────────────────────────────────

export async function fetchCyber(): Promise<VigilEvent[]> {
  const res = await fetch('/api/cyber');
  if (!res.ok) throw new Error(`/api/cyber ${res.status}`);
  const { victims, kev } = await res.json();

  // The proxy returns null for a feed that failed. Both null = a real failure; one null = partial.
  const victimsOk = Array.isArray(victims);
  const kevOk = Array.isArray(kev);
  if (!victimsOk && !kevOk) throw new Error('ransomware.live and CISA KEV both unavailable');
  if (!victimsOk) addWarning('cyber', 'ransomware.live unavailable (showing CISA KEV only)');
  if (!kevOk) addWarning('cyber', 'CISA KEV unavailable (showing ransomware claims only)');

  return [...normalizeVictims(victims), ...normalizeKev(kev)].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}
