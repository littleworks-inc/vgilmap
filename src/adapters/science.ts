/**
 * Science adapter — proxies through /api/science (Vercel edge function).
 * Normalizes NASA DONKI Solar Flares, Geomagnetic Storms, and NeoWs Asteroids.
 */
import type { VigilEvent, Severity } from '../types';

// ── Solar Flare normalizer ─────────────────────────────────

interface FLREvent {
  flrID: string;
  beginTime: string;
  classType: string;
  sourceLocation: string;
}

function flrSeverity(classType: string): Severity {
  const c = (classType ?? '').toUpperCase();
  if (c.startsWith('X')) return 'critical';
  if (c.startsWith('M')) return 'high';
  if (c.startsWith('C')) return 'medium';
  if (c.startsWith('B')) return 'low';
  return 'low';
}

function normalizeFLR(data: unknown): VigilEvent[] {
  if (!Array.isArray(data)) return [];
  return (data as FLREvent[]).map(ev => ({
    id: `science-flr-${ev.flrID}`,
    timestamp: ev.beginTime ?? new Date().toISOString(),
    domain: 'science',
    category: 'research',
    severity: flrSeverity(ev.classType),
    title: `Solar Flare (Class ${ev.classType ?? 'Unknown'})`,
    description: `Solar flare detected. Class: ${ev.classType}. Source location: ${ev.sourceLocation ?? 'N/A'}.`,
    location: { lat: 0, lng: 0, country: 'Sun', region: 'Solar', label: 'Solar Activity' },
    source: 'NASA DONKI',
    sourceUrl: 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/',
    confidence: 0.99,
    tags: ['solar-flare', 'space-weather', ev.classType ?? ''],
    metadata: { classType: ev.classType, sourceLocation: ev.sourceLocation },
  }));
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
  try {
    const res = await fetch('/api/science');
    if (!res.ok) throw new Error(`/api/science ${res.status}`);
    const { flr, gst, neo } = await res.json();

    const all: VigilEvent[] = [
      ...normalizeFLR(flr),
      ...normalizeGST(gst),
      ...normalizeNeo(neo),
    ];

    return all.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  } catch (err) {
    console.warn('[Science]', err);
    return [];
  }
}
