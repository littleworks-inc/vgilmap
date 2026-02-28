/**
 * NASA EONET Adapter — Natural Disaster & Climate Events
 *
 * NASA's Earth Observatory Natural Event Tracker (EONET) provides
 * real-time natural event data. Free, no API key, CORS-enabled.
 *
 * API: https://eonet.gsfc.nasa.gov/docs/v3
 */
import type { VigilEvent, Severity } from '../types';

// ─── API types ─────────────────────────────────────────────

interface EONETGeometry {
  date: string;
  type: 'Point' | 'Polygon';
  coordinates: number[] | number[][][];   // GeoJSON: [lng, lat] for Point
  magnitudeValue?: number | null;
  magnitudeUnit?: string | null;
}

interface EONETEvent {
  id: string;
  title: string;
  link: string;
  description: string | null;
  categories: Array<{ id: string; title: string }>;
  sources: Array<{ id: string; url: string }>;
  geometry: EONETGeometry[];
}

interface EONETResponse {
  events: EONETEvent[];
}

// ─── Category → domain/category/severity map ───────────────

interface CatMeta {
  domain: 'climate' | 'disaster';
  category: string;
  baseSeverity: Severity;
}

const CATEGORY_MAP: Record<string, CatMeta> = {
  wildfires:           { domain: 'disaster', category: 'wildfire',       baseSeverity: 'high'   },
  volcanoes:           { domain: 'disaster', category: 'volcanic',       baseSeverity: 'high'   },
  severeStorms:        { domain: 'climate',  category: 'extreme-weather', baseSeverity: 'medium' },
  floods:              { domain: 'climate',  category: 'flood',           baseSeverity: 'medium' },
  drought:             { domain: 'climate',  category: 'drought',         baseSeverity: 'low'    },
  landslides:          { domain: 'disaster', category: 'landslide',       baseSeverity: 'medium' },
  earthquakes:         { domain: 'disaster', category: 'earthquake',      baseSeverity: 'medium' },
  seaLakeIce:          { domain: 'climate',  category: 'extreme-weather', baseSeverity: 'low'    },
  snow:                { domain: 'climate',  category: 'extreme-weather', baseSeverity: 'low'    },
  temperatureExtremes: { domain: 'climate',  category: 'extreme-weather', baseSeverity: 'medium' },
  dustHaze:            { domain: 'climate',  category: 'extreme-weather', baseSeverity: 'low'    },
  waterColor:          { domain: 'climate',  category: 'environmental',   baseSeverity: 'low'    },
  manmade:             { domain: 'disaster', category: 'industrial',      baseSeverity: 'medium' },
};

function eonetSeverity(catId: string, title: string): Severity {
  const base = CATEGORY_MAP[catId]?.baseSeverity ?? 'low';
  const t = title.toLowerCase();
  // Escalate well-known high-impact keywords
  if (/major|extreme|catastrophic|category [45]|super/.test(t)) return 'critical';
  if (/large|significant|intense|severe/.test(t) && base === 'low') return 'medium';
  return base;
}

// ─── Main fetch ────────────────────────────────────────────

const EONET_URL =
  'https://eonet.gsfc.nasa.gov/api/v3/events' +
  '?status=open&limit=50&days=14';

export async function fetchGDELT(): Promise<VigilEvent[]> {
  const res = await fetch(EONET_URL, {
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`EONET fetch failed: ${res.status} ${res.statusText}`);
  }

  const json: EONETResponse = await res.json();
  const events: VigilEvent[] = [];

  for (const ev of json.events ?? []) {
    // Need at least one geometry with coordinates
    const geo = ev.geometry?.[0];
    if (!geo || geo.type !== 'Point') continue;

    const coords = geo.coordinates as number[];
    const lng = coords[0];
    const lat = coords[1];
    if (lat == null || lng == null) continue;

    // Use first category
    const cat = ev.categories?.[0];
    const catId = cat?.id ?? 'manmade';
    const meta = CATEGORY_MAP[catId] ?? { domain: 'disaster', category: 'other', baseSeverity: 'low' };
    const sourceUrl = ev.sources?.[0]?.url ?? ev.link;

    events.push({
      id: `eonet-${ev.id}`,
      timestamp: geo.date,
      domain: meta.domain,
      category: meta.category,
      severity: eonetSeverity(catId, ev.title),
      title: ev.title,
      description: ev.description ?? `${cat?.title ?? 'Natural event'} tracked by NASA EONET.`,
      location: {
        lat,
        lng,
        country: '',
        region: '',
        label: ev.title,
      },
      source: 'NASA EONET',
      sourceUrl: sourceUrl ?? 'https://eonet.gsfc.nasa.gov',
      confidence: 0.95,
      tags: [catId, meta.category, meta.domain],
      metadata: {
        eonet_id: ev.id,
        category: cat?.title,
        magnitude: geo.magnitudeValue,
        magnitude_unit: geo.magnitudeUnit,
      },
    });
  }

  return events;
}
