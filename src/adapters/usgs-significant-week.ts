/**
 * USGS Significant Earthquakes — Past 7 Days Adapter
 *
 * Feed: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson
 * "Significant" = USGS significance score ≥ 600 (roughly M4.5+, or M4 with strong felt reports).
 *
 * Differences from the 24h all-earthquakes adapter (usgs.ts):
 *  - 7-day window instead of 24 hours
 *  - Only significant events (M4.5+ class), not every micro-quake
 *  - Adds the 'significant' tag on every event
 *  - Useful for the historical-context view and anomaly detection baseline
 */

import type { VigilEvent, Severity } from '../types';

// ─── USGS GeoJSON types (shared shape with usgs.ts) ────────

interface USGSProperties {
  mag: number;
  place: string;
  time: number;
  updated: number;
  url: string;
  felt: number | null;
  alert: string | null;
  status: string;
  tsunami: number;
  sig: number;
  type: string;
  title: string;
}

interface USGSFeature {
  type: 'Feature';
  properties: USGSProperties;
  geometry: {
    type: 'Point';
    coordinates: [number, number, number];
  };
  id: string;
}

interface USGSFeed {
  type: 'FeatureCollection';
  features: USGSFeature[];
}

// ─── Helpers ───────────────────────────────────────────────

function magnitudeToSeverity(mag: number): Severity {
  if (mag >= 7.0) return 'critical';
  if (mag >= 5.5) return 'high';
  if (mag >= 4.5) return 'medium';
  return 'low';
}

function extractRegion(place: string): { country: string; region: string } {
  if (!place) return { country: 'Unknown', region: 'Unknown' };
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

// ─── Main fetch ────────────────────────────────────────────

const USGS_SIGNIFICANT_WEEK_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson';

const MIN_MAGNITUDE = 4.5;

export async function fetchUSGSSignificantWeek(): Promise<VigilEvent[]> {
  const response = await fetch(USGS_SIGNIFICANT_WEEK_URL);

  if (!response.ok) {
    throw new Error(
      `USGS significant_week fetch failed: ${response.status} ${response.statusText}`
    );
  }

  const feed: USGSFeed = await response.json();

  return feed.features
    .filter(f => f.geometry && f.properties.mag !== null && f.properties.mag >= MIN_MAGNITUDE)
    .map((feature): VigilEvent => {
      const props = feature.properties;
      const [lng, lat, depthKm] = feature.geometry.coordinates;
      const mag = props.mag ?? 0;
      const { country, region } = extractRegion(props.place ?? '');

      const tags: string[] = ['earthquake', 'significant'];
      if (depthKm <= 10)  tags.push('shallow');
      if (depthKm >= 300) tags.push('deep');
      if (props.tsunami === 1) tags.push('tsunami-risk');
      if (props.felt && props.felt > 100) tags.push('widely-felt');
      tags.push(`M${mag.toFixed(1)}`);

      return {
        id: `usgs-sig-${feature.id}`,
        timestamp: new Date(props.time).toISOString(),
        domain: 'disaster',
        category: 'earthquake',
        severity: magnitudeToSeverity(mag),
        title: props.title ?? `M${mag.toFixed(1)} earthquake`,
        description: [
          `Significant M${mag.toFixed(1)} earthquake`,
          props.place ? `near ${props.place}` : '',
          depthKm ? `at depth ${depthKm} km` : '',
          props.felt ? `· felt by ${props.felt.toLocaleString()} people` : '',
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
        sourceUrl: props.url ?? USGS_SIGNIFICANT_WEEK_URL,
        confidence: 0.97,
        tags,
        metadata: {
          magnitude: mag,
          depth_km: depthKm,
          significance: props.sig,
          felt: props.felt,
          alert: props.alert,
          tsunami: props.tsunami === 1,
          status: props.status,
          feed: 'significant_week',
        },
      };
    });
}
