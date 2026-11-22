/**
 * Source definitions shared by the app and the API: what each source is, how fresh it should be,
 * how often it is worth refreshing, and what its coverage and location precision really are.
 *
 * Nothing here fetches anything. Upstream URLs and secrets live in api/_lib/sources.ts (server only).
 */
import type { Domain, LocationPrecision } from '../types';

export interface SourceMeta {
  key: string;
  label: string;
  domain: Domain;
  /** If the newest event is older than this, the source is "stale" (responding, but not current). */
  staleAfterHours: number;
  /** An extra on top of other sources: its failure is shown in Data Health but raises no alarm. */
  optional?: boolean;
  /** How often this source is worth refreshing (the app's timer and the CDN cache both use it). */
  refreshSeconds: number;
  /** The default location precision of this source's events. */
  precision: LocationPrecision;
  /** What the layer covers and where it is limited, in plain words. */
  coverage: string;
}

export const SOURCE_META: SourceMeta[] = [
  { key: 'usgs-day', label: 'USGS 24h', domain: 'disaster', staleAfterHours: 3, refreshSeconds: 120, precision: 'exact',
    coverage: 'Global earthquakes of every magnitude, last 24 hours' },
  { key: 'usgs-week', label: 'USGS Significant', domain: 'disaster', staleAfterHours: 168, refreshSeconds: 900, precision: 'exact',
    coverage: 'Global earthquakes of M4.5+, last 7 days' },
  { key: 'nasa-firms', label: 'NASA FIRMS', domain: 'climate', staleAfterHours: 24, refreshSeconds: 1800, precision: 'exact',
    coverage: 'Global satellite fire detections, last 24 hours. Sampled: only the ~50 strongest (by radiative power) are kept, and low-confidence detections are dropped' },
  { key: 'noaa', label: 'NOAA Alerts', domain: 'climate', staleAfterHours: 12, refreshSeconds: 300, precision: 'area',
    coverage: 'United States and territories only. Alerts without a polygon are listed but not placed on the map' },
  { key: 'conflict-rss', label: 'Conflict News (RSS)', domain: 'conflict', staleAfterHours: 12, refreshSeconds: 600, precision: 'country',
    coverage: 'English-language headlines (BBC, DW, Al Jazeera, Guardian, NPR) that name a country; placed at that country, not at the event' },
  { key: 'gdelt', label: 'GDELT Conflict', domain: 'conflict', staleAfterHours: 24, optional: true, refreshSeconds: 900, precision: 'country',
    coverage: 'Global news index; often rate-limited, so treated as an optional extra' },
  { key: 'who', label: 'WHO Outbreak News', domain: 'health', staleAfterHours: 720, refreshSeconds: 3600, precision: 'country',
    coverage: 'Global, but WHO publishes only a few Disease Outbreak News items a month' },
  { key: 'reliefweb', label: 'ReliefWeb Disasters', domain: 'disaster', staleAfterHours: 1080, refreshSeconds: 3600, precision: 'country',
    coverage: 'Global UN OCHA disaster declarations (a handful a month), placed at the affected country' },
  { key: 'economic-news', label: 'Economic & Labor News', domain: 'economic', staleAfterHours: 24, refreshSeconds: 900, precision: 'country',
    coverage: 'English-language strike and jobs headlines that name a country; placed at that country' },
  { key: 'science', label: 'NASA Space Weather', domain: 'science', staleAfterHours: 168, refreshSeconds: 900, precision: 'unknown',
    coverage: 'Solar flares (NOAA, M/X class), geomagnetic storms and near-Earth asteroids. Not tied to a place on Earth, so list-only' },
  { key: 'cyber', label: 'Ransomware & KEV', domain: 'cyber', staleAfterHours: 72, refreshSeconds: 900, precision: 'country',
    coverage: 'Ransomware victim claims (published by the attackers, unverified; placed at the victim country) and CISA KEV exploited vulnerabilities (no location)' },
  { key: 'cyber-breaches', label: 'Data Breaches (HIBP)', domain: 'cyber', staleAfterHours: 504, refreshSeconds: 3600, precision: 'country',
    coverage: 'Breaches catalogued by Have I Been Pwned; the country is guessed from the site domain, otherwise list-only' },
  { key: 'cyber-news', label: 'Cyber Incident News', domain: 'cyber', staleAfterHours: 24, refreshSeconds: 600, precision: 'country',
    coverage: 'Headlines from security outlets classified by keywords; the country named in the headline, never the attacker nation' },
];

export const SOURCE_KEYS = SOURCE_META.map(s => s.key);

export function sourceMeta(key: string): SourceMeta | undefined {
  return SOURCE_META.find(s => s.key === key);
}
