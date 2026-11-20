/**
 * NASA FIRMS Adapter — VIIRS Near-Real-Time Wildfires
 *
 * Fetched via our own /api/firms proxy (api/firms.ts), which holds the NASA key server-side,
 * queries the NOAA-20/21 VIIRS feeds, and returns only the strongest detections as CSV.
 * (The old Suomi-NPP feed stopped updating on 2026-11-02, and calling NASA directly from the
 * browser meant a ~3 MB download per visitor plus a key in the JS bundle.)
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

export async function fetchNASAFirms(): Promise<VigilEvent[]> {
  const response = await fetch('/api/firms');

  if (!response.ok) {
    throw new Error(`NASA FIRMS fetch failed: ${response.status} ${response.statusText}`);
  }

  const csv = await response.text();

  // FIRMS returns HTML error pages when the key is invalid or rate-limited
  if (csv.trim().startsWith('<')) {
    throw new Error('NASA FIRMS returned an HTML error response. Check API key or rate limits.');
  }

  const allRows = parseCSV(csv);

  // The proxy already trimmed to the strongest detections by Fire Radiative Power.
  // Keep the top 50 so the sidebar / AI brief reflects genuinely significant fires.
  const rows = [...allRows]
    .sort((a, b) => b.frp - a.frp)
    .slice(0, 50);

  return rows.map((row): VigilEvent => {
    const severity = brightnessToSeverity(row.bright_ti4, row.frp);
    const timestamp = acqToISO(row.acq_date, row.acq_time);

    const tags: string[] = ['wildfire', 'satellite-detected'];
    if (row.daynight === 'N') tags.push('night-detection');
    if (row.confidence === 'h') tags.push('high-confidence');
    if (row.frp > 500) tags.push('extreme-frp');

    return {
      // Position + acquisition time: stable across refreshes (an array index was not, because
      // the list is re-sorted by FRP each time, which broke deep links to a selected fire).
      id: `firms-${row.latitude.toFixed(3)}-${row.longitude.toFixed(3)}-${row.acq_date}-${row.acq_time}`,
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
