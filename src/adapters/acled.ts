/**
 * ACLED Adapter — Armed Conflict Location & Event Data
 *
 * Public API, no key required for the read endpoint.
 * Returns the 50 most recent conflict events globally.
 *
 * Docs: https://developer.acleddata.com/
 */

import type { VigilEvent, Severity, Category } from '../types';

// ─── API types ─────────────────────────────────────────────

interface ACLEDRow {
  data_id:       string;
  event_date:    string;   // "2024-01-15"
  event_type:    string;   // "Battles" | "Explosions/Remote violence" | …
  sub_event_type: string;
  actor1:        string;
  country:       string;
  admin1:        string;
  location:      string;
  latitude:      string;
  longitude:     string;
  fatalities:    string;   // numeric string
  notes:         string;
  source:        string;
  timestamp:     string;   // unix seconds string
}

interface ACLEDResponse {
  success: boolean;
  data: ACLEDRow[];
  error?: string;
}

// ─── Severity mapping ──────────────────────────────────────

function acledSeverity(fatalities: number, eventType: string): Severity {
  if (fatalities >= 50) return 'critical';
  if (fatalities >= 10) return 'high';
  if (fatalities >= 1)  return 'medium';
  // Zero fatalities — use event type
  if (eventType === 'Explosions/Remote violence') return 'medium';
  if (eventType === 'Battles')                    return 'low';
  if (eventType === 'Riots')                      return 'low';
  return 'info';
}

// ─── Category mapping ──────────────────────────────────────

function acledCategory(eventType: string): Category {
  switch (eventType) {
    case 'Riots':
    case 'Protests':
      return 'protest';
    case 'Battles':
    case 'Explosions/Remote violence':
    case 'Violence against civilians':
    case 'Strategic developments':
    default:
      return 'armed-conflict';
  }
}

// ─── Main fetch ────────────────────────────────────────────

const ACLED_URL =
  'https://api.acleddata.com/acled/read.php' +
  '?terms=accept' +
  '&limit=50' +
  '&fields=data_id,event_date,event_type,sub_event_type,actor1,' +
  'country,admin1,location,latitude,longitude,fatalities,notes,source,timestamp' +
  '&format=json';

export async function fetchACLED(): Promise<VigilEvent[]> {
  const response = await fetch(ACLED_URL);

  if (!response.ok) {
    throw new Error(`ACLED fetch failed: ${response.status} ${response.statusText}`);
  }

  const json: ACLEDResponse = await response.json();

  if (!json.success || !Array.isArray(json.data)) {
    throw new Error(`ACLED API error: ${json.error ?? 'success:false'}`);
  }

  return json.data
    .filter(row => {
      const lat = parseFloat(row.latitude);
      const lng = parseFloat(row.longitude);
      return !isNaN(lat) && !isNaN(lng);
    })
    .map((row): VigilEvent => {
      const fatalities = parseInt(row.fatalities, 10) || 0;
      const lat        = parseFloat(row.latitude);
      const lng        = parseFloat(row.longitude);
      const severity   = acledSeverity(fatalities, row.event_type);
      const category   = acledCategory(row.event_type);

      const notes = (row.notes ?? '').slice(0, 300);

      const tags: string[] = [
        row.event_type.toLowerCase(),
        row.sub_event_type.toLowerCase(),
        row.country.toLowerCase(),
      ];
      if (fatalities > 0) tags.push('fatalities-reported');

      return {
        id:        `acled-${row.data_id}`,
        timestamp: `${row.event_date}T00:00:00Z`,
        domain:    'conflict',
        category,
        severity,
        title:     `${row.event_type} — ${row.location}, ${row.country}`,
        description: notes,
        location: {
          lat,
          lng,
          country: row.country,
          region:  row.admin1,
          label:   `${row.location}, ${row.country}`,
        },
        source:    'ACLED',
        sourceUrl: 'https://acleddata.com',
        confidence: 0.85,
        tags,
        metadata: {
          event_type:     row.event_type,
          sub_event_type: row.sub_event_type,
          actor1:         row.actor1,
          fatalities,
          admin1:         row.admin1,
          source_org:     row.source,
        },
      };
    });
}
