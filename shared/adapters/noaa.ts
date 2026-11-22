/**
 * NOAA Weather Alerts Adapter
 *
 * Feed: https://api.weather.gov/alerts/active?status=actual&limit=100
 * Returns active NWS alerts for the US and territories.
 * No API key required — public endpoint.
 *
 * NOAA severity levels → VigilEvent severity:
 *   Extreme  → critical
 *   Severe   → high
 *   Moderate → medium
 *   Minor    → low
 *   Unknown  → info
 */

import type { VigilEvent, Severity } from '../types';

// ─── NOAA API types ────────────────────────────────────────

/** The slice of GeoJSON geometry we read (kept local so shared/ has no type-package dependency). */
type Geometry =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'MultiPoint' | 'LineString'; coordinates: number[][] }
  | { type: 'Polygon' | 'MultiLineString'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: 'GeometryCollection'; geometries: Geometry[] };

interface NOAAAlertProperties {
  id: string;
  areaDesc: string;
  geocode?: { UGC?: string[]; SAME?: string[] };
  affectedZones: string[];
  sent: string;           // ISO 8601
  effective: string;
  onset: string | null;
  expires: string;
  ends: string | null;
  status: string;         // 'Actual' | 'Exercise' | 'System' | 'Test' | 'Draft'
  messageType: string;    // 'Alert' | 'Update' | 'Cancel' | ...
  category: string;       // 'Met' | 'Geo' | 'Safety' | ...
  severity: string;       // 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown'
  certainty: string;      // 'Observed' | 'Likely' | 'Possible' | 'Unlikely' | 'Unknown'
  urgency: string;        // 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown'
  event: string;          // 'Tornado Warning' | 'Flash Flood Watch' | ...
  headline: string | null;
  description: string | null;
  instruction: string | null;
  response: string;
  parameters: Record<string, unknown>;
}

interface NOAAAlertFeature {
  type: 'Feature';
  id: string;
  geometry: Geometry | null;
  properties: NOAAAlertProperties;
}

interface NOAAAlertFeed {
  type: 'FeatureCollection';
  features: NOAAAlertFeature[];
  pagination?: { next?: string };
}

// ─── Severity mapping ──────────────────────────────────────

function noaaSeverityToVigilSeverity(noaa: string): Severity {
  switch (noaa.toLowerCase()) {
    case 'extreme':  return 'critical';
    case 'severe':   return 'high';
    case 'moderate': return 'medium';
    case 'minor':    return 'low';
    default:         return 'info';
  }
}

function certaintyToConfidence(certainty: string): number {
  switch (certainty.toLowerCase()) {
    case 'observed':  return 0.99;
    case 'likely':    return 0.80;
    case 'possible':  return 0.50;
    case 'unlikely':  return 0.20;
    default:          return 0.60;
  }
}

// ─── Geometry centroid ─────────────────────────────────────

/**
 * Extract a representative lat/lng from NOAA geometry.
 * Falls back to a rough US centre if geometry is absent.
 */
function getCentroid(geometry: Geometry | null): { lat: number; lng: number } | null {
  if (!geometry) return null;

  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates as [number, number];
    return { lat, lng };
  }

  // For Polygon / MultiPolygon, compute bbox centre
  const coords: number[][] = [];

  function collectCoords(g: Geometry) {
    if (g.type === 'Point') {
      coords.push(g.coordinates as number[]);
    } else if (g.type === 'MultiPoint' || g.type === 'LineString') {
      coords.push(...(g.coordinates as number[][]));
    } else if (g.type === 'Polygon' || g.type === 'MultiLineString') {
      for (const ring of g.coordinates as number[][][]) coords.push(...ring);
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates as number[][][][])
        for (const ring of poly) coords.push(...ring);
    } else if (g.type === 'GeometryCollection') {
      for (const sub of g.geometries) collectCoords(sub);
    }
  }

  collectCoords(geometry);
  if (coords.length === 0) return null;

  const lngs = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };
}

// ─── Main fetch ────────────────────────────────────────────

/** Normalize an NWS active-alerts GeoJSON feed. */
export function normalizeNOAA(feed: NOAAAlertFeed): VigilEvent[] {

  const events: VigilEvent[] = [];

  for (const feature of feed.features ?? []) {
    const props = feature.properties;

    // Skip non-actual statuses (exercises, tests, etc.)
    if (props.status !== 'Actual') continue;

    // Many NWS alerts (zone-based) carry no geometry. Keep them: they are real alerts, shown
    // in the list with their area description, just not placed on the map.
    const centroid = getCentroid(feature.geometry);

    const severity = noaaSeverityToVigilSeverity(props.severity);
    const confidence = certaintyToConfidence(props.certainty);
    const timestamp = props.sent ?? props.effective;

    const tags: string[] = [
      props.event.toLowerCase().replace(/\s+/g, '-'),
      props.urgency.toLowerCase(),
      props.certainty.toLowerCase(),
    ].filter(Boolean);

    if (props.messageType === 'Update') tags.push('update');

    const title = props.headline ?? props.event;
    const description = [
      props.description?.slice(0, 300),
      props.instruction ? `\nInstruction: ${props.instruction.slice(0, 150)}` : '',
    ]
      .filter(Boolean)
      .join('')
      .trim();

    events.push({
      id: `noaa-${props.id ?? feature.id}`,
      timestamp,
      domain: 'climate',
      category: 'extreme-weather',
      severity,
      title: title ?? props.event,
      description: description || `${props.event} in ${props.areaDesc}`,
      location: {
        lat: centroid?.lat ?? 0,
        lng: centroid?.lng ?? 0,
        country: 'US',
        region: props.areaDesc,
        label: props.areaDesc,
      },
      source: 'NOAA NWS',
      sourceUrl: `https://www.weather.gov/`,
      confidence,
      tags,
      metadata: {
        event_type: props.event,
        severity_raw: props.severity,
        certainty: props.certainty,
        urgency: props.urgency,
        effective: props.effective,
        expires: props.expires,
        ends: props.ends,
        message_type: props.messageType,
        ...(centroid ? {} : { unlocated: true }),
      },
    });
  }

  return events;
}
