/**
 * NASA FIRMS Adapter — VIIRS SNPP Near-Real-Time Wildfires
 *
 * Feed: https://firms.modaps.eosdis.nasa.gov/api/area/csv/DEMO_KEY/VIIRS_SNPP_NRT/-180,-90,180,90/1
 * Returns CSV with the last 24 hours of global thermal anomalies / active fires.
 *
 * DEMO_KEY works for low-traffic development. Replace with a real NASA key via
 * VITE_NASA_FIRMS_API_KEY for production (free at https://firms.modaps.eosdis.nasa.gov/api/map_key/).
 *
 * CSV columns (VIIRS NRT):
 *   latitude, longitude, bright_ti4, scan, track, acq_date, acq_time,
 *   satellite, instrument, confidence, version, bright_ti5, frp, daynight
 */

import type { VigilEvent, Severity } from '../types';

// ─── CSV parsing ───────────────────────────────────────────

interface FIRMSRow {
  latitude: number;
  longitude: number;
  bright_ti4: number;   // brightness temperature channel 4 (Kelvin-ish, ~fire intensity)
  acq_date: string;     // YYYY-MM-DD
  acq_time: string;     // HHMM
  satellite: string;
  confidence: string;   // 'l' | 'n' | 'h'  (low / nominal / high)
  frp: number;          // Fire Radiative Power (MW)
  daynight: string;     // 'D' | 'N'
}

function parseCSV(csv: string): FIRMSRow[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());

  const idx = (name: string) => headers.indexOf(name);
  const iLat    = idx('latitude');
  const iLng    = idx('longitude');
  const iBright = idx('bright_ti4');
  const iDate   = idx('acq_date');
  const iTime   = idx('acq_time');
  const iSat    = idx('satellite');
  const iConf   = idx('confidence');
  const iFrp    = idx('frp');
  const iDN     = idx('daynight');

  const rows: FIRMSRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < headers.length) continue;

    const lat = parseFloat(cols[iLat]);
    const lng = parseFloat(cols[iLng]);
    if (isNaN(lat) || isNaN(lng)) continue;

    rows.push({
      latitude: lat,
      longitude: lng,
      bright_ti4: parseFloat(cols[iBright]) || 0,
      acq_date: cols[iDate]?.trim() ?? '',
      acq_time: cols[iTime]?.trim() ?? '0000',
      satellite: cols[iSat]?.trim() ?? 'VIIRS',
      confidence: cols[iConf]?.trim().toLowerCase() ?? 'n',
      frp: parseFloat(cols[iFrp]) || 0,
      daynight: cols[iDN]?.trim() ?? 'D',
    });
  }

  return rows;
}

// ─── Severity mapping ──────────────────────────────────────

function brightnessToSeverity(brightness: number, frp: number): Severity {
  if (brightness > 400 || frp > 500) return 'high';
  if (brightness > 350 || frp > 100) return 'medium';
  return 'low';
}

function confidenceScore(conf: string): number {
  switch (conf) {
    case 'h': return 0.95;
    case 'n': return 0.75;
    case 'l': return 0.50;
    default:  return 0.70;
  }
}

// ─── Timestamp helper ──────────────────────────────────────

function acqToISO(date: string, time: string): string {
  // date = "2024-01-15", time = "0135" (HHMM)
  const hh = time.padStart(4, '0').slice(0, 2);
  const mm = time.padStart(4, '0').slice(2, 4);
  return `${date}T${hh}:${mm}:00Z`;
}

// ─── Main fetch ────────────────────────────────────────────

const API_KEY =
  typeof import.meta !== 'undefined'
    ? (import.meta.env?.VITE_NASA_FIRMS_API_KEY ?? 'DEMO_KEY')
    : 'DEMO_KEY';

const FIRMS_URL =
  `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${API_KEY}/VIIRS_SNPP_NRT/-180,-90,180,90/1`;

export async function fetchNASAFirms(): Promise<VigilEvent[]> {
  const response = await fetch(FIRMS_URL);

  if (!response.ok) {
    throw new Error(`NASA FIRMS fetch failed: ${response.status} ${response.statusText}`);
  }

  const csv = await response.text();

  // FIRMS returns HTML error pages when the key is invalid or rate-limited
  if (csv.trim().startsWith('<')) {
    throw new Error('NASA FIRMS returned an HTML error response. Check API key or rate limits.');
  }

  const rows = parseCSV(csv);

  return rows.map((row, index): VigilEvent => {
    const severity = brightnessToSeverity(row.bright_ti4, row.frp);
    const timestamp = acqToISO(row.acq_date, row.acq_time);

    const tags: string[] = ['wildfire', 'satellite-detected'];
    if (row.daynight === 'N') tags.push('night-detection');
    if (row.confidence === 'h') tags.push('high-confidence');
    if (row.frp > 500) tags.push('extreme-frp');

    return {
      id: `firms-viirs-${row.acq_date}-${row.acq_time}-${index}`,
      timestamp,
      domain: 'climate',
      category: 'wildfire',
      severity,
      title: `Active Fire — ${row.latitude.toFixed(2)}°, ${row.longitude.toFixed(2)}°`,
      description: [
        `Satellite-detected active fire (VIIRS/${row.satellite}).`,
        `Brightness: ${row.bright_ti4.toFixed(0)} K.`,
        row.frp > 0 ? `Fire Radiative Power: ${row.frp.toFixed(0)} MW.` : '',
        `Confidence: ${row.confidence === 'h' ? 'High' : row.confidence === 'l' ? 'Low' : 'Nominal'}.`,
      ]
        .filter(Boolean)
        .join(' '),
      location: {
        lat: row.latitude,
        lng: row.longitude,
        country: '',   // FIRMS doesn't provide country — could enrich later
        region: '',
        label: `${row.latitude.toFixed(3)}°, ${row.longitude.toFixed(3)}°`,
      },
      source: 'NASA FIRMS',
      sourceUrl: 'https://firms.modaps.eosdis.nasa.gov/',
      confidence: confidenceScore(row.confidence),
      tags,
      metadata: {
        brightness: row.bright_ti4,
        frp: row.frp,
        satellite: row.satellite,
        confidence_raw: row.confidence,
        daynight: row.daynight,
      },
    };
  });
}
