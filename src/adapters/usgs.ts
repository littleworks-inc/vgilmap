/**
 * USGS Earthquake Adapter
 *
 * Fetches from: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson
 * Updates every 5 minutes on the USGS side.
 *
 * Normalizes each earthquake into the VigilEvent schema.
 */

import type { VigilEvent, Severity } from '../types';

// ─── USGS GeoJSON types ────────────────────────────────────

interface USGSProperties {
  mag: number;
  place: string;
  time: number;       // Unix ms
  updated: number;    // Unix ms
  url: string;
  detail: string;
  felt: number | null;
  alert: string | null;  // 'green' | 'yellow' | 'orange' | 'red' | null
  status: string;
  tsunami: number;    // 0 or 1
  sig: number;        // significance score 0-1000
  type: string;       // 'earthquake' | 'quarry blast' | ...
  title: string;
}

interface USGSFeature {
  type: 'Feature';
  properties: USGSProperties;
  geometry: {
    type: 'Point';
    coordinates: [number, number, number]; // [lng, lat, depth_km]
  };
  id: string;
}

interface USGSFeed {
  type: 'FeatureCollection';
  metadata: {
    generated: number;
    url: string;
    title: string;
    status: number;
    count: number;
  };
  features: USGSFeature[];
}

// ─── Severity mapping ──────────────────────────────────────

function magnitudeToSeverity(mag: number): Severity {
  if (mag >= 7.0) return 'critical';
  if (mag >= 5.5) return 'high';
  if (mag >= 4.0) return 'medium';
  if (mag >= 2.5) return 'low';
  return 'info';
}

/** Extract a country-ish label from the USGS place string.
 *  USGS place looks like "14km NNE of Ridgecrest, CA" or "South of the Fiji Islands"
 */
function extractRegion(place: string): { country: string; region: string } {
  if (!place) return { country: 'Unknown', region: 'Unknown' };

  // "… of Location, STATE_OR_COUNTRY"
  const ofMatch = place.match(/of (.+)$/i);
  if (ofMatch) {
    const parts = ofMatch[1].split(',').map(s => s.trim());
    return {
      country: parts[parts.length - 1] ?? ofMatch[1],
      region: ofMatch[1],
    };
  }
  return { country: place, region: place };
}

// ─── Main fetch function ───────────────────────────────────

const USGS_FEED_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

export async function fetchUSGSEarthquakes(): Promise<VigilEvent[]> {
  const response = await fetch(USGS_FEED_URL);

  if (!response.ok) {
    throw new Error(`USGS fetch failed: ${response.status} ${response.statusText}`);
  }

  const feed: USGSFeed = await response.json();

  return feed.features
    .filter(f => f.geometry && f.properties.mag !== null)
    .map((feature): VigilEvent => {
      const props = feature.properties;
      const [lng, lat, depthKm] = feature.geometry.coordinates;
      const mag = props.mag ?? 0;
      const { country, region } = extractRegion(props.place ?? '');

      const tags: string[] = [props.type ?? 'earthquake'];
      if (depthKm <= 10) tags.push('shallow');
      if (depthKm >= 300) tags.push('deep');
      if (props.tsunami === 1) tags.push('tsunami-risk');
      if (mag >= 5) tags.push(`M${mag.toFixed(1)}`);

      return {
        id: `usgs-${feature.id}`,
        timestamp: new Date(props.time).toISOString(),
        domain: 'disaster',
        category: 'earthquake',
        severity: magnitudeToSeverity(mag),
        title: props.title ?? `M${mag.toFixed(1)} earthquake`,
        description: [
          `Magnitude ${mag.toFixed(1)} earthquake`,
          props.place ? `near ${props.place}` : '',
          depthKm ? `at depth ${depthKm} km` : '',
        ]
          .filter(Boolean)
          .join(' '),
        location: {
          lat,
          lng,
          country,
          region,
          label: props.place ?? `${lat.toFixed(2)}, ${lng.toFixed(2)}`,
        },
        source: 'USGS',
        sourceUrl: props.url ?? USGS_FEED_URL,
        confidence: 0.95,
        tags,
        metadata: {
          magnitude: mag,
          depth_km: depthKm,
          significance: props.sig,
          felt: props.felt,
          alert: props.alert,
          tsunami: props.tsunami === 1,
          status: props.status,
        },
      };
    });
}
