/**
 * ReliefWeb Disasters Adapter — Conflict & Crisis Events
 *
 * ReliefWeb (OCHA/UN) tracks active global disasters and crises.
 * Free, no API key, CORS-enabled, no rate limits.
 *
 * API: https://apidoc.reliefweb.int/
 * Endpoint: /v2/disasters
 */
import type { VigilEvent, Severity } from '../types';

interface RWDisaster {
  id: number;
  fields: {
    name: string;
    status: string;           // 'current' | 'past' | 'alert'
    date: { created: string; changed?: string };
    type: Array<{ id: number; name: string; primary?: boolean }>;
    country: Array<{
      id: number;
      name: string;
      iso3?: string;
      location?: { lat: number; lon: number };
      primary?: boolean;
    }>;
    glide?: string;
  };
}

interface RWResponse {
  data: RWDisaster[];
  totalCount: number;
}

const CONFLICT_TYPES = new Set([
  'Complex Emergency', 'Civil Unrest', 'Insecurity',
  'Armed Conflict', 'Violence', 'Other',
]);

const DISASTER_TYPES = new Set([
  'Flood', 'Flash Flood', 'Tropical Cyclone', 'Storm', 'Drought',
  'Wildfire', 'Earthquake', 'Tsunami', 'Volcano', 'Landslide',
  'Cold Wave', 'Heat Wave', 'Epidemic',
]);

// Country name → [lat, lng] fallback when API has no coordinates
const COUNTRY_COORDS: Record<string, [number, number]> = {
  'Afghanistan': [33.9, 67.7], 'Somalia': [5.2, 46.2],
  'Sudan': [12.9, 30.2], 'South Sudan': [6.9, 31.3],
  'Syria': [34.8, 38.9], 'Yemen': [15.6, 48.5],
  'Ethiopia': [9.1, 40.5], 'Nigeria': [9.1, 8.7],
  'DRC': [-4.0, 21.8], 'Democratic Republic of the Congo': [-4.0, 21.8],
  'Congo': [-4.0, 21.8], 'Mali': [17.6, -4.0],
  'Burkina Faso': [12.4, -1.5], 'Niger': [17.6, 8.1],
  'Chad': [15.5, 18.7], 'Mozambique': [-18.7, 35.5],
  'Myanmar': [21.9, 96.0], 'Haiti': [18.9, -72.3],
  'Ukraine': [48.4, 31.2], 'Iraq': [33.2, 43.7],
  'Libya': [26.3, 17.2], 'Palestine': [31.9, 35.2],
  'Colombia': [4.6, -74.1], 'Venezuela': [6.4, -66.6],
  'Bangladesh': [23.7, 90.4], 'Pakistan': [30.4, 69.3],
  'Philippines': [12.9, 121.8], 'Indonesia': [-0.8, 113.9],
  'India': [20.6, 79.0], 'Nepal': [28.4, 84.1],
  'Malawi': [-13.3, 34.3], 'Zimbabwe': [-19.0, 29.2],
  'Kenya': [-0.0, 37.9], 'Uganda': [1.4, 32.3],
  'Cameroon': [3.8, 11.5], 'Central African Republic': [6.6, 20.9],
};

function rwSeverity(status: string, typeName: string): Severity {
  if (status === 'alert') return 'critical';
  if (CONFLICT_TYPES.has(typeName)) {
    return status === 'current' ? 'high' : 'medium';
  }
  return status === 'current' ? 'medium' : 'low';
}

const RW_URL = 'https://api.reliefweb.int/v2/disasters?appname=vigilmap';

const RW_BODY = JSON.stringify({
  preset: 'latest',
  limit: 50,
  fields: {
    include: [
      'name', 'status', 'date.created',
      'type.name', 'type.primary',
      'country.name', 'country.iso3', 'country.location', 'country.primary',
      'glide',
    ],
  },
});

export async function fetchGDELT(): Promise<VigilEvent[]> {
  const res = await fetch(RW_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: RW_BODY,
  });

  if (!res.ok) {
    throw new Error(`ReliefWeb fetch failed: ${res.status} ${res.statusText}`);
  }

  const json: RWResponse = await res.json();
  const events: VigilEvent[] = [];

  for (const item of json.data ?? []) {
    const f = item.fields;

    // Get primary country (or first)
    const primaryCountry =
      f.country?.find(c => c.primary) ?? f.country?.[0];
    if (!primaryCountry) continue;

    // Get coordinates: API location → fallback lookup → skip
    let lat: number, lng: number;
    if (primaryCountry.location?.lat != null) {
      lat = primaryCountry.location.lat;
      lng = primaryCountry.location.lon;
    } else {
      const fb = COUNTRY_COORDS[primaryCountry.name];
      if (!fb) continue;
      [lat, lng] = fb;
    }

    // Get primary disaster type
    const primaryType =
      f.type?.find(t => t.primary) ?? f.type?.[0];
    const typeName = primaryType?.name ?? 'Unknown';

    // Decide domain: conflict types → conflict, else climate
    const isConflict = CONFLICT_TYPES.has(typeName);
    const domain = isConflict ? 'conflict' : 'climate';
    const category = isConflict ? 'armed-conflict' : 'extreme-weather';
    const severity = rwSeverity(f.status, typeName);

    const countryNames = f.country?.map(c => c.name).join(', ') ?? primaryCountry.name;

    events.push({
      id: `reliefweb-${item.id}`,
      timestamp: f.date?.created ?? new Date().toISOString(),
      domain,
      category,
      severity,
      title: f.name,
      description: `${typeName} — ${countryNames}. Status: ${f.status}.`,
      location: {
        lat,
        lng,
        country: primaryCountry.name,
        region: countryNames,
        label: primaryCountry.name,
      },
      source: 'ReliefWeb/OCHA',
      sourceUrl: `https://reliefweb.int/disaster/${item.id}`,
      confidence: 0.92,
      tags: [
        typeName.toLowerCase().replace(/\s+/g, '-'),
        f.status,
        primaryCountry.iso3?.toLowerCase() ?? '',
        ...(f.glide ? [f.glide.toLowerCase()] : []),
      ].filter(Boolean),
      metadata: {
        disaster_type: typeName,
        status: f.status,
        glide: f.glide,
        countries: f.country?.map(c => c.name),
      },
    });
  }

  return events;
}

// Suppress unused-variable warning — DISASTER_TYPES reserved for future filtering
void DISASTER_TYPES;
