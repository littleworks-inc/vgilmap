/**
 * VigilMap Public REST API — /api/v1/events
 *
 * GET /api/v1/events
 *   ?domain=disaster,climate,health,conflict,economic,labor,science
 *   ?severity=info,low,medium,high,critical
 *   ?limit=50 (max 100)
 *   ?since=2025-01-01T00:00:00Z (ISO timestamp)
 *
 * Free tier: no key required, 100 events max, CDN-cached 5min.
 * Returns unified VigilEvent[] schema.
 */
export const config = { runtime: 'edge' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
};
// ── Types (duplicated from src/types for edge runtime) ─────
type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
type Domain = 'health' | 'climate' | 'conflict' | 'economic' | 'disaster' | 'labor' | 'science';
interface VigilEvent {
  id: string;
  timestamp: string;
  domain: Domain;
  category: string;
  severity: Severity;
  title: string;
  description: string;
  location: { lat: number; lng: number; country: string; region: string; label: string };
  source: string;
  sourceUrl: string;
  confidence: number;
  tags: string[];
  metadata?: Record<string, unknown>;
}
// ── Source fetchers ────────────────────────────────────────
async function fetchUSGS(): Promise<VigilEvent[]> {
  const res = await fetch(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'
  );
  if (!res.ok) return [];
  const json = await res.json();
  return (json.features ?? []).slice(0, 100).map((f: any) => ({
    id: `usgs-${f.id}`,
    timestamp: new Date(f.properties.time).toISOString(),
    domain: 'disaster' as Domain,
    category: 'earthquake',
    severity: f.properties.mag >= 6 ? 'high' : f.properties.mag >= 4 ? 'medium' : 'low',
    title: f.properties.title,
    description: `M${f.properties.mag} earthquake. Depth: ${f.geometry.coordinates[2]}km.`,
    location: {
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      country: '',
      region: f.properties.place ?? '',
      label: f.properties.place ?? '',
    },
    source: 'USGS',
    sourceUrl: f.properties.url,
    confidence: 0.99,
    tags: ['earthquake', `m${Math.floor(f.properties.mag)}`],
    metadata: { magnitude: f.properties.mag, depth: f.geometry.coordinates[2] },
  }));
}
async function fetchFIRMS(): Promise<VigilEvent[]> {
  const key = (globalThis as any).process?.env?.VITE_NASA_FIRMS_API_KEY ?? '';
  if (!key) return [];
  const res = await fetch(
    `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/-180,-90,180,90/1`
  );
  if (!res.ok) return [];
  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  const idx = (h: string) => headers.indexOf(h);
  return lines.slice(1, 51).map((line, i) => {
    const cols = line.split(',');
    const lat = parseFloat(cols[idx('latitude')]);
    const lng = parseFloat(cols[idx('longitude')]);
    const frp = parseFloat(cols[idx('frp')]);
    return {
      id: `firms-${i}-${cols[idx('acq_date')]}`,
      timestamp: `${cols[idx('acq_date')]}T00:00:00Z`,
      domain: 'climate' as Domain,
      category: 'wildfire',
      severity: frp > 100 ? 'high' : frp > 20 ? 'medium' : 'low',
      title: `Active wildfire (FRP: ${frp} MW)`,
      description: `Satellite-detected fire. Brightness: ${cols[idx('bright_ti4')]}K.`,
      location: { lat, lng, country: '', region: '', label: `${lat.toFixed(2)},${lng.toFixed(2)}` },
      source: 'NASA FIRMS',
      sourceUrl: 'https://firms.modaps.eosdis.nasa.gov',
      confidence: 0.88,
      tags: ['wildfire', 'satellite'],
      metadata: { frp, satellite: cols[idx('satellite')] },
    };
  }).filter(e => !isNaN(e.location.lat));
}
async function fetchNOAA(): Promise<VigilEvent[]> {
  const res = await fetch('https://api.weather.gov/alerts/active?message_type=alert', {
    headers: { 'User-Agent': '(VigilMap, contact@vigilmap.app)', 'Accept': 'application/geo+json' },
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.features ?? []).slice(0, 50).map((f: any) => {
    const p = f.properties;
    const geo = f.geometry?.coordinates;
    const [lng, lat] = Array.isArray(geo?.[0]?.[0]) ? geo[0][0] : [0, 0];
    return {
      id: `noaa-${p.id}`,
      timestamp: p.sent ?? new Date().toISOString(),
      domain: 'climate' as Domain,
      category: 'extreme-weather',
      severity: p.severity === 'Extreme' ? 'critical' : p.severity === 'Severe' ? 'high' : 'medium',
      title: p.headline ?? p.event,
      description: (p.description ?? '').slice(0, 300),
      location: { lat: lat || 38, lng: lng || -97, country: 'US', region: p.areaDesc ?? '', label: p.areaDesc ?? '' },
      source: 'NOAA NWS',
      sourceUrl: p.web ?? 'https://weather.gov',
      confidence: 0.97,
      tags: ['weather', p.event?.toLowerCase().replace(/\s+/g, '-') ?? 'alert'],
      metadata: { event_type: p.event, severity: p.severity, urgency: p.urgency },
    };
  });
}
// ── Filtering ──────────────────────────────────────────────
const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0, low: 1, medium: 2, high: 3, critical: 4,
};
function applyFilters(
  events: VigilEvent[],
  params: URLSearchParams
): VigilEvent[] {
  let result = [...events];
  const domain = params.get('domain');
  if (domain) {
    const allowed = new Set(domain.split(',').map(s => s.trim()));
    result = result.filter(e => allowed.has(e.domain));
  }
  const severity = params.get('severity');
  if (severity) {
    const minSev = severity as Severity;
    const minOrder = SEVERITY_ORDER[minSev] ?? 0;
    result = result.filter(e => SEVERITY_ORDER[e.severity] >= minOrder);
  }
  const since = params.get('since');
  if (since) {
    const sinceMs = new Date(since).getTime();
    if (!isNaN(sinceMs)) {
      result = result.filter(e => new Date(e.timestamp).getTime() >= sinceMs);
    }
  }
  const limitStr = params.get('limit');
  const limit = Math.min(parseInt(limitStr ?? '100', 10) || 100, 100);
  result = result.slice(0, limit);
  return result;
}
// ── Main handler ───────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    // Fetch all sources in parallel, fail gracefully per source
    const [usgs, firms, noaa] = await Promise.all([
      fetchUSGS().catch(() => []),
      fetchFIRMS().catch(() => []),
      fetchNOAA().catch(() => []),
    ]);
    const all: VigilEvent[] = [...usgs, ...firms, ...noaa];
    // Deduplicate
    const seen = new Set<string>();
    const deduped = all.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    // Sort by timestamp desc
    deduped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const filtered = applyFilters(deduped, params);
    const body = JSON.stringify({
      ok: true,
      count: filtered.length,
      total: deduped.length,
      generated: new Date().toISOString(),
      version: '1.0.0',
      data: filtered,
    }, null, 0);
    return new Response(body, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        'X-VigilMap-Version': '1.0.0',
        'X-VigilMap-Count': String(filtered.length),
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      }
    );
  }
}
