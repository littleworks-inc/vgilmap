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
  | 'science';

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
  climate: '#f97316',
  health: '#ec4899',
  conflict: '#7c3aed',
  economic: '#eab308',
  labor: '#3b82f6',
  science: '#10b981',
};

export const DOMAIN_ICONS: Record<Domain, string> = {
  disaster: '🌋',
  climate: '🌡️',
  health: '🏥',
  conflict: '⚔️',
  economic: '💰',
  labor: '✊',
  science: '🔬',
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
