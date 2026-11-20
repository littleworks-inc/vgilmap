/**
 * Science adapter — proxies through /api/science (Vercel edge function).
 * Normalizes NOAA SWPC solar flares, NASA DONKI geomagnetic storms, and NASA NeoWs asteroids.
 */
import type { VigilEvent, Severity } from '../types';
import { addWarning } from './source-warnings';

// ── Solar Flare normalizer (NOAA SWPC GOES X-ray flares) ───

interface SwpcFlare {
  begin_time?: string;
  max_time?: string;
  begin_class?: string;
  max_class?: string;
  end_class?: string;
}

/**
 * Only M- and X-class flares are reported: of ~80 flares in a typical week, most are C/B-class
 * background noise with no practical effect. M can disturb radio on the sunlit side of Earth;
 * strong M5+ and X-class can affect satellites and navigation.
 */
function flrSeverity(maxClass: string): Severity {
  const c = maxClass.toUpperCase();
  if (c.startsWith('X')) return 'critical';
  if (c.startsWith('M')) return parseFloat(c.slice(1)) >= 5 ? 'high' : 'medium';
  return 'low';
}

function normalizeFLR(data: unknown): VigilEvent[] {
  if (!Array.isArray(data)) return [];
  return (data as SwpcFlare[])
    .filter(f => /^[MX]/i.test(f.max_class ?? '') && f.max_time)
    .map(f => {
      const cls = f.max_class as string;
      const peak = new Date(f.max_time as string);
      const hhmm = peak.toISOString().slice(11, 16);
      return {
        id: `science-flr-${f.begin_time ?? f.max_time}`,
        timestamp: peak.toISOString(),
        domain: 'science' as const,
        category: 'research',
        severity: flrSeverity(cls),
        title: `Solar Flare (Class ${cls})`,
        description: `${cls}-class solar flare peaked at ${hhmm} UTC (began as ${f.begin_class ?? 'unknown'}, ended ${f.end_class ?? 'unknown'}). ${
          cls.toUpperCase().startsWith('X') ? 'X-class flares can disrupt satellites, GPS and HF radio.' : 'M-class flares can briefly disrupt HF radio on the sunlit side of Earth.'}`,
        // A flare happens on the Sun: there is no map location, so it's kept off the map.
        location: { lat: 0, lng: 0, country: 'Sun', region: 'Solar', label: 'Solar Activity' },
        source: 'NOAA SWPC',
        sourceUrl: 'https://www.swpc.noaa.gov/products/goes-x-ray-flux',
        confidence: 0.99,
        tags: ['solar-flare', 'space-weather', cls],
        metadata: { classType: cls, beginClass: f.begin_class, endClass: f.end_class, unlocated: true },
      };
    });
}

// ── Geomagnetic Storm normalizer ───────────────────────────

interface GSTKp {
  observedTime: string;
  kpIndex: number;
}
interface GSTEvent {
  gstID: string;
  startTime: string;
  allKpIndex?: GSTKp[];
}

function gstSeverity(kp: number): Severity {
  if (kp >= 8) return 'critical';
  if (kp >= 6) return 'high';
  if (kp >= 5) return 'medium';
  if (kp >= 4) return 'low';
  return 'low';
}

function normalizeGST(data: unknown): VigilEvent[] {
  if (!Array.isArray(data)) return [];
  return (data as GSTEvent[]).map(ev => {
    const kpIndex = ev.allKpIndex?.[0]?.kpIndex ?? 0;
    return {
      id: `science-gst-${ev.gstID}`,
      timestamp: ev.startTime ?? new Date().toISOString(),
      domain: 'science',
      category: 'research',
      severity: gstSeverity(kpIndex),
      title: `Geomagnetic Storm (Kp ${kpIndex})`,
      description: `Geomagnetic storm detected with Kp index ${kpIndex}. May affect satellites, GPS and power grids.`,
      location: { lat: 90, lng: 0, country: 'Global', region: 'Geosphere', label: 'Global Geomagnetic' },
      source: 'NASA DONKI',
      sourceUrl: 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/',
      confidence: 0.95,
      tags: ['geomagnetic-storm', 'space-weather'],
      metadata: { kpIndex },
    };
  });
}

// ── Near-Earth Asteroid normalizer ────────────────────────

interface NeoObject {
  id: string;
  name: string;
  is_potentially_hazardous_asteroid: boolean;
  close_approach_data: Array<{
    close_approach_date: string;
    miss_distance: { kilometers: string };
    relative_velocity: { kilometers_per_hour: string };
  }>;
  estimated_diameter: {
    meters: {
      estimated_diameter_max: number;
    };
  };
}

interface NeoFeed {
  near_earth_objects: Record<string, NeoObject[]>;
}

function neoSeverity(missKm: number): Severity {
  if (missKm < 1_000_000) return 'high';
  if (missKm < 5_000_000) return 'medium';
  return 'low';
}

function normalizeNeo(data: unknown): VigilEvent[] {
  if (!data || typeof data !== 'object') return [];
  const feed = data as NeoFeed;
  const events: VigilEvent[] = [];

  for (const dayObjects of Object.values(feed.near_earth_objects ?? {})) {
    for (const neo of dayObjects) {
      if (!neo.is_potentially_hazardous_asteroid) continue;
      const approach = neo.close_approach_data?.[0];
      if (!approach) continue;
      const missKm = parseFloat(approach.miss_distance.kilometers);
      const diameterM = neo.estimated_diameter?.meters?.estimated_diameter_max ?? 0;

      events.push({
        id: `science-neo-${neo.id}`,
        timestamp: approach.close_approach_date
          ? new Date(approach.close_approach_date).toISOString()
          : new Date().toISOString(),
        domain: 'science',
        category: 'research',
        severity: neoSeverity(missKm),
        title: `Near-Earth Asteroid: ${neo.name}`,
        description: `Asteroid ${neo.name} passing Earth. Miss distance: ${missKm.toLocaleString()}km. Diameter: ${diameterM.toFixed(0)}m.`,
        location: { lat: 0, lng: 0, country: 'Space', region: 'Near-Earth', label: 'Near-Earth Object' },
        source: 'NASA NeoWs',
        sourceUrl: 'https://cneos.jpl.nasa.gov/',
        confidence: 0.99,
        tags: ['asteroid', 'near-earth', 'space'],
        metadata: { missKm, diameterM },
      });
    }
  }
  return events;
}

// ── Main export ───────────────────────────────────────────

export async function fetchScience(): Promise<VigilEvent[]> {
  const res = await fetch('/api/science');
  if (!res.ok) throw new Error(`/api/science ${res.status}`);
  const { flr, gst, neo } = await res.json();

  // The proxy returns null for an upstream NASA endpoint that failed.
  const failed = [
    flr == null && 'solar flares',
    gst == null && 'geomagnetic storms',
    neo == null && 'asteroids',
  ].filter(Boolean) as string[];
  if (failed.length === 3) throw new Error('all NASA feeds unavailable (check NASA_API_KEY / rate limit)');
  if (failed.length > 0) addWarning('science', `NASA feed unavailable: ${failed.join(', ')}`);

  // None of these happen at a place on Earth, so none belong on the map. Flag them so they stay in
  // lists (and the Data Health counts) without being plotted at a made-up position.
  const all: VigilEvent[] = [
    ...normalizeFLR(flr),
    ...normalizeGST(gst),
    ...normalizeNeo(neo),
  ].map(e => ({ ...e, metadata: { ...e.metadata, unlocated: true } }));

  return all.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}
