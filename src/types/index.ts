// ============================================================
// VigilMap Unified Event Schema
// Every data adapter normalizes its raw output into VigilEvent.
// ============================================================

export type Domain =
  | 'health'
  | 'climate'
  | 'conflict'
  | 'economic'
  | 'disaster'
  | 'labor'
  | 'science'
  | 'cyber';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type Category =
  // disaster
  | 'earthquake'
  | 'tsunami'
  | 'hurricane'
  | 'tornado'
  | 'flood'
  | 'landslide'
  | 'volcanic'
  // climate
  | 'wildfire'
  | 'air-quality'
  | 'extreme-weather'
  | 'deforestation'
  // health
  | 'outbreak'
  | 'drug-shortage'
  | 'hospital-stress'
  // conflict
  | 'armed-conflict'
  | 'protest'
  | 'displacement'
  // economic
  | 'unemployment'
  | 'food-insecurity'
  | 'housing-stress'
  // labor
  | 'strike'
  | 'labor-violation'
  // science
  | 'research'
  | 'retraction'
  // cyber
  | 'ransomware'
  | 'vulnerability'
  | 'data-breach'
  | 'malware'
  | 'ddos'
  | 'phishing'
  | 'supply-chain'
  | 'espionage'
  | 'cyberattack'
  | string; // Allow arbitrary categories from future adapters

export interface EventLocation {
  lat: number;
  lng: number;
  country: string;
  region: string;
  label: string;
}

export interface VigilEvent {
  id: string;
  timestamp: string;          // ISO 8601
  domain: Domain;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  location: EventLocation;
  source: string;             // e.g. "USGS", "WHO", "ACLED"
  sourceUrl: string;
  confidence: number;         // 0–1
  tags: string[];
  relatedEvents?: string[];   // IDs of correlated events
  // Adapter-specific extras can live in metadata
  metadata?: Record<string, unknown>;
}

// ─── Time window ───────────────────────────────────────────

/**
 * How far back to show events. Sources mix very different ages (live earthquakes vs.
 * multi-day ransomware claims vs. archive items years old), so everything is filtered
 * to one window. 30d is the hard cap: anything older never appears.
 */
export const TIME_WINDOWS = [
  { id: '24h', label: '24h', ms: 24 * 3_600_000 },
  { id: '3d',  label: '3d',  ms: 3 * 24 * 3_600_000 },
  { id: '7d',  label: '7d',  ms: 7 * 24 * 3_600_000 },
  { id: '30d', label: '30d', ms: 30 * 24 * 3_600_000 },
] as const;

export type TimeWindowId = (typeof TIME_WINDOWS)[number]['id'];
export const DEFAULT_TIME_WINDOW: TimeWindowId = '7d';

export function timeWindowMs(id: TimeWindowId): number {
  return TIME_WINDOWS.find(w => w.id === id)?.ms ?? TIME_WINDOWS[2].ms;
}

// ─── Map / focus helpers ───────────────────────────────────

/**
 * Events with no real-world location (e.g. CISA KEV vulnerabilities) are flagged
 * `metadata.unlocated` by their adapter. They stay in lists but never go on the map
 * or into geographic anomaly detection, where a fake position would mislead.
 */
export function isMappable(ev: VigilEvent): boolean {
  return !ev.metadata?.unlocated;
}

/** The one wording used everywhere an unmapped event is listed (sidebar, drawer, ticker). */
export const NO_MAP_LOCATION = 'no map location';

/** A cyber "drill-down" chosen from the Cyber Trends panel. */
export type CyberFocusDimension = 'countries' | 'sectors' | 'groups';

export interface CyberFocus {
  dimension: CyberFocusDimension;
  key: string;    // ISO country code, sector name, or lowercase group name
  label: string;  // human-readable, for the filter chip
}

export function matchesCyberFocus(ev: VigilEvent, f: CyberFocus): boolean {
  if (ev.category !== 'ransomware') return false;
  const m = ev.metadata ?? {};
  switch (f.dimension) {
    case 'countries': return String(m.countryCode ?? '') === (f.key === '??' ? '' : f.key);
    case 'sectors':   return String(m.sector ?? 'Unknown') === f.key;
    case 'groups':    return String(m.group ?? '').toLowerCase() === f.key;
  }
}

// ─── Severity helpers ──────────────────────────────────────

export const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const SEVERITY_COLORS: Record<Severity, string> = {
  info: '#6b7280',     // gray
  low: '#facc15',      // yellow
  medium: '#f97316',   // orange
  high: '#ef4444',     // red
  critical: '#7c3aed', // purple
};

export const DOMAIN_COLORS: Record<Domain, string> = {
  disaster: '#ef4444',
  climate: '#22d3ee',
  health: '#ec4899',
  conflict: '#7c3aed',
  economic: '#eab308',
  labor: '#3b82f6',
  science: '#10b981',
  cyber: '#84cc16',
};

export const DOMAIN_ICONS: Record<Domain, string> = {
  disaster: '🌋',
  climate: '🌡️',
  health: '🏥',
  conflict: '⚔️',
  economic: '💰',
  labor: '✊',
  science: '🔬',
  cyber: '🛡️',
};

// ─── Map display helpers ───────────────────────────────────

/**
 * Returns the map dot colour for an earthquake based on magnitude.
 * Red = 5+, Orange = 3-5, Yellow = <3
 */
export function earthquakeColor(magnitude: number): string {
  if (magnitude >= 5) return '#ef4444';   // red
  if (magnitude >= 3) return '#f97316';   // orange
  return '#facc15';                        // yellow
}

/**
 * Returns a dot radius (px) scaled loosely by magnitude.
 */
export function earthquakeRadius(magnitude: number): number {
  if (magnitude >= 7) return 14;
  if (magnitude >= 5) return 10;
  if (magnitude >= 3) return 7;
  return 5;
}
