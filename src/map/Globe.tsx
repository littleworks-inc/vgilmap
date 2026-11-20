/**
 * Globe.tsx
 *
 * Full-screen MapLibre GL map that renders VigilEvents as coloured circles.
 * For earthquakes it uses the magnitude-based colour scale:
 *   Red   = M5+
 *   Orange= M3-5
 *   Yellow= M<3
 *
 * Props:
 *   events     – all VigilEvents to render
 *   onEventClick – called with the clicked event
 */

import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { VigilEvent } from '../types';
import { isMappable } from '../types';
import { earthquakeColor, earthquakeRadius, DOMAIN_COLORS } from '../types';

// ─── constants ─────────────────────────────────────────────

const LAYER_ID = 'vigil-events';
const SOURCE_ID = 'vigil-events';

// Inline copies of domain/severity maps — popup HTML is a plain string,
// can't reference module-level imports at serialization time.
const POPUP_DOMAIN_COLORS: Record<string, string> = {
  disaster: '#ef4444', climate: '#22d3ee', health: '#ec4899',
  conflict: '#7c3aed', economic: '#eab308', labor: '#3b82f6', science: '#10b981', cyber: '#84cc16',
};
// Cluster colour = domain with the highest aggregated count (ties go to earlier entries).
const CLUSTER_DOMAINS = ['disaster', 'conflict', 'climate', 'health', 'economic', 'labor', 'science', 'cyber'] as const;
const CLUSTER_COLOR_EXPR: unknown[] = ['case'];
CLUSTER_DOMAINS.slice(0, -1).forEach((d, i) => {
  CLUSTER_COLOR_EXPR.push(
    ['all', ...CLUSTER_DOMAINS.slice(i + 1).map(o => ['>=', ['get', `cnt_${d}`], ['get', `cnt_${o}`]])],
    POPUP_DOMAIN_COLORS[d],
  );
});
CLUSTER_COLOR_EXPR.push(POPUP_DOMAIN_COLORS[CLUSTER_DOMAINS[CLUSTER_DOMAINS.length - 1]]);

const POPUP_DOMAIN_ICONS: Record<string, string> = {
  disaster: '🌋', climate: '🌡️', health: '🏥',
  conflict: '⚔️', economic: '💰', labor: '✊', science: '🔬', cyber: '🛡️',
};
const POPUP_SEVERITY_COLORS: Record<string, string> = {
  critical: '#7c3aed', high: '#ef4444', medium: '#f97316',
  low: '#facc15', info: '#6b7280',
};

// Primary basemap: CARTO Dark Matter *vector* style (keyless, crisp at any zoom).
// CARTO's old raster tiles now return an "API KEY REQUIRED" placeholder image, but this
// vector style (served from Protomaps-based tiles) is still free to load.
const PRIMARY_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Fallback basemap, used automatically if the style above fails to load:
// Esri "World Dark Gray Base" raster tiles — no API key needed.
// Note the {z}/{y}/{x} order, which differs from the usual {z}/{x}/{y}. Esri's terms expect
// attribution; for heavy production traffic use an ArcGIS/MapTiler key instead.
const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
  sources: {
    'basemap-tiles': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors',
      maxzoom: 16, // tiles end here; MapLibre overzooms beyond it
    },
  },
  layers: [
    {
      id: 'basemap-tiles',
      type: 'raster',
      source: 'basemap-tiles',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

// ─── helpers ───────────────────────────────────────────────

const CYBER_WEIGHT = 0.3;     // a cyber event counts as 0.3 of another event in clusters
const CYBER_DOT_SCALE = 0.75; // and its dot is 25% smaller

function eventsToGeoJSON(
  events: VigilEvent[]
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: events.filter(isMappable).map(ev => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [ev.location.lng, ev.location.lat],
      },
      properties: {
        id: ev.id,
        title: ev.title,
        severity: ev.severity,
        category: ev.category,
        domain: ev.domain,
        magnitude: (ev.metadata?.magnitude as number) ?? 0,
        color: ev.category === 'earthquake'
          ? earthquakeColor((ev.metadata?.magnitude as number) ?? 0)
          : DOMAIN_COLORS[ev.domain] ?? '#6b7280',
        radius: ev.category === 'earthquake'
          ? earthquakeRadius((ev.metadata?.magnitude as number) ?? 0)
          : (ev.severity === 'critical' ? 10
          : ev.severity === 'high' ? 8
          : ev.severity === 'medium' ? 6
          : 5) * (ev.domain === 'cyber' ? CYBER_DOT_SCALE : 1),
        // Cyber is high-volume and only country-accurate: smaller, fainter, and it counts
        // for less when deciding a cluster's size/colour so it can't drown other domains.
        weight: ev.domain === 'cyber' ? CYBER_WEIGHT : 1,
        opacity: ev.domain === 'cyber' ? 0.7 : 0.9,
        timestamp: ev.timestamp,
        description: ev.description,
        sourceUrl: ev.sourceUrl,
        // Serialised as JSON strings — MapLibre flattens nested objects
        metadata: JSON.stringify(ev.metadata ?? {}),
        tags: JSON.stringify(ev.tags ?? []),
      },
    })),
  };
}

// ─── popup renderer ────────────────────────────────────────

interface PopupProps {
  id: string;
  title: string;
  severity: string;
  category: string;
  domain: string;
  timestamp: string;
  description: string;
  sourceUrl: string;
  metadata: string | Record<string, unknown>;
  tags: string | string[];
  [key: string]: unknown;
}

function renderPopup(props: PopupProps): string {
  // MapLibre serialises nested objects to JSON strings — parse them back
  const meta: Record<string, unknown> =
    typeof props.metadata === 'string'
      ? JSON.parse(props.metadata)
      : (props.metadata ?? {});
  const tags: string[] =
    typeof props.tags === 'string'
      ? JSON.parse(props.tags)
      : (props.tags ?? []);

  const domainColor  = POPUP_DOMAIN_COLORS[props.domain]  ?? '#6b7280';
  const domainIcon   = POPUP_DOMAIN_ICONS[props.domain]   ?? '🌐';
  const severityColor = POPUP_SEVERITY_COLORS[props.severity] ?? '#6b7280';

  // ── secondary info line (domain / category aware) ───────
  let secondary = '';
  let linkLabel = 'Source ↗';

  if (props.category === 'earthquake') {
    const mag   = typeof props.magnitude === 'number' ? props.magnitude : Number(meta.magnitude ?? 0);
    const depth = meta.depth_km != null ? `${Number(meta.depth_km).toFixed(0)} km` : '?';
    secondary = `🔴 M${Number(mag).toFixed(1)} · depth ${depth}`;
    if (tags.includes('tsunami-risk')) {
      secondary += ` <span style="background:#1e3a5f;border:1px solid #3b82f6;color:#60a5fa;font-size:10px;padding:1px 5px;border-radius:4px;">⚠ Tsunami Risk</span>`;
    }
    linkLabel = 'USGS details ↗';

  } else if (props.category === 'wildfire') {
    const frp        = meta.frp        != null ? `${Number(meta.frp).toFixed(0)} MW` : '?';
    const brightness = meta.brightness != null ? `${Number(meta.brightness).toFixed(0)} K` : '?';
    const sat        = (meta.satellite as string) ?? 'VIIRS';
    const confRaw    = (meta.confidence_raw as string) ?? 'n';
    const confLabel  = confRaw === 'h' ? 'High' : confRaw === 'l' ? 'Low' : 'Nominal';
    secondary = `🔥 FRP: ${frp} · Brightness: ${brightness}<br/>Satellite: ${sat} · Confidence: ${confLabel}`;
    linkLabel = 'NASA FIRMS ↗';

  } else if (props.category === 'extreme-weather') {
    const evType    = (meta.event_type  as string) ?? 'Weather Alert';
    const certainty = (meta.certainty   as string) ?? '';
    const urgency   = (meta.urgency     as string) ?? '';
    const expires   = meta.expires
      ? new Date(meta.expires as string).toLocaleDateString()
      : '';
    secondary = `🌪 ${evType}`;
    if (certainty || urgency) secondary += `<br/>Certainty: ${certainty} · Urgency: ${urgency}`;
    if (expires) secondary += `<br/>Expires: ${expires}`;
    linkLabel = 'NWS Alert ↗';

  } else if (props.category === 'armed-conflict' || props.category === 'protest') {
    const evType    = (meta.event_type     as string) ?? props.category;
    const subType   = (meta.sub_event_type as string) ?? '';
    const actor     = (meta.actor1         as string) ?? '';
    const deaths    = meta.fatalities != null ? Number(meta.fatalities) : null;
    const fatalLine = deaths !== null
      ? (deaths > 0 ? `${deaths} fatalities` : 'No fatalities reported')
      : '';
    secondary = `⚔️ ${evType}${subType ? ` · ${subType}` : ''}`;
    if (actor)     secondary += `<br/>Actor: ${actor}`;
    if (fatalLine) secondary += `<br/>${fatalLine}`;
    linkLabel = 'GDELT news ↗';

  } else if (props.category === 'outbreak') {
    const country = (meta.country as string) ?? props.domain;
    secondary = `🏥 WHO Disease Outbreak<br/>Country: ${country}`;
    linkLabel = 'News source ↗';

  } else if (props.category === 'ransomware') {
    const victim = (meta.victim as string) ?? 'Unknown';
    const sector = (meta.sector as string) ?? 'Unknown';
    const group = (meta.group as string) ?? 'Unknown';
    secondary = `🛡️ Ransomware<br/>Victim: ${victim}<br/>Sector: ${sector} · Group: ${group}`;
    linkLabel = 'ransomware.live ↗';

  } else if (props.category === 'vulnerability') {
    const vendor = (meta.vendor as string) ?? '';
    const product = (meta.product as string) ?? '';
    secondary = `🛡️ Actively exploited vulnerability<br/>${vendor} ${product}${meta.ransomwareUse ? '<br/>Used in ransomware campaigns' : ''}`;
    linkLabel = 'NVD ↗';

  } else if (props.domain === 'science') {
    const tagsArr = Array.isArray(props.tags)
      ? props.tags
      : JSON.parse(typeof props.tags === 'string' ? props.tags : '[]');
    secondary = `🔬 ${props.category} · ${(tagsArr as string[]).join(', ')}`;
    linkLabel = 'NASA ↗';

  } else {
    // Generic: just domain icon + severity badge
    secondary = `${domainIcon} <span style="color:${domainColor};font-weight:600;">${props.domain}</span>`;
  }

  // ── truncate description ────────────────────────────────
  const desc = (props.description ?? '').length > 120
    ? props.description.slice(0, 120) + '…'
    : (props.description ?? '');

  // ── timestamp ───────────────────────────────────────────
  const ts = new Date(props.timestamp).toLocaleString();

  return `
    <div style="
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #f1f5f9;
      min-width: 220px;
      max-width: 280px;
    ">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
        <strong style="font-size:14px;color:#f1f5f9;line-height:1.3;flex:1;">
          ${domainIcon} ${props.title ?? 'Event'}
        </strong>
        <span style="
          font-size:10px;padding:2px 7px;border-radius:10px;
          background:${severityColor}22;border:1px solid ${severityColor};
          color:${severityColor};white-space:nowrap;flex-shrink:0;font-weight:600;
        ">${props.severity}</span>
      </div>

      <div style="color:${domainColor};font-size:12px;margin-bottom:6px;line-height:1.5;">
        ${secondary}
      </div>

      <div style="color:#64748b;font-size:11px;margin-bottom:6px;">${ts}</div>

      ${desc ? `<div style="color:#94a3b8;font-size:12px;margin-bottom:8px;line-height:1.4;">${desc}</div>` : ''}

      ${props.sourceUrl
        ? `<a href="${props.sourceUrl}" target="_blank" rel="noopener"
             style="color:#3b82f6;font-size:12px;text-decoration:none;"
           >${linkLabel}</a>`
        : ''}
    </div>
  `;
}

// ─── component ─────────────────────────────────────────────

interface GlobeProps {
  events: VigilEvent[];
  onEventClick?: (event: VigilEvent) => void;
}

export function Globe({ events, onEventClick }: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const eventsRef = useRef<VigilEvent[]>(events);

  // Keep a stable ref to events for use inside event handlers
  eventsRef.current = events;

  // ── Initialise map once ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: PRIMARY_STYLE_URL,
      center: [0, 20],
      zoom: 1.8,
      minZoom: 1,
      maxZoom: 18,
      attributionControl: { compact: true },
    });

    // If the primary style itself fails (not just a single tile), fall back to Esri raster.
    let mapLoaded = false;
    let usedFallback = false;
    map.on('error', (e: { sourceId?: string; error?: Error }) => {
      if (!mapLoaded && !usedFallback && !e.sourceId) {
        usedFallback = true;
        console.warn('[map] primary style failed, using Esri fallback:', e.error);
        map.setStyle(MAP_STYLE);
      }
    });

    // 3D globe projection. Re-applied on every style load so it survives the fallback
    // style swap above (setStyle resets the projection to the style's own).
    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-right');

    // ── Idle auto-pan ───────────────────────────────────
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let panFrame: number | null = null;
    let isPanning = false;
    const startPan = () => {
      if (isPanning) return;
      isPanning = true;
      const pan = () => {
        if (!isPanning) return;
        map.panBy([0.4, 0], { duration: 0, animate: false });
        panFrame = requestAnimationFrame(pan);
      };
      panFrame = requestAnimationFrame(pan);
    };
    const stopPan = () => {
      isPanning = false;
      if (panFrame) { cancelAnimationFrame(panFrame); panFrame = null; }
    };
    const resetIdle = () => {
      stopPan();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(startPan, 30000); // 30s idle → start pan
    };
    // Start idle timer
    resetIdle();
    // Stop panning on any user interaction
    ['mousedown', 'wheel', 'touchstart', 'keydown'].forEach(evt => {
      map.getContainer().addEventListener(evt, resetIdle, { passive: true });
    });
    // Store cleanup + resetIdle on the map for later
    (map as any)._vigilCleanup = () => {
      stopPan();
      if (idleTimer) clearTimeout(idleTimer);
    };
    (map as any)._vigilResetIdle = resetIdle;

    // ── Add source + layer when style loads ───────────────
    map.on('load', () => {
      mapLoaded = true;
      // If style failed, fall back to OSM raster
      if (!map.getLayer('background') && !map.getSource('osm-tiles')) {
        // Nothing special needed here — the Esri fallback is applied in the error handler above
      }

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: eventsToGeoJSON(eventsRef.current),
        cluster: true,
        clusterMaxZoom: 5,
        clusterRadius: 40,
        // Aggregate per-domain event counts so we can color by dominant domain
        clusterProperties: {
          cnt_disaster: ['+', ['case', ['==', ['get', 'domain'], 'disaster'], 1, 0]],
          cnt_climate:  ['+', ['case', ['==', ['get', 'domain'], 'climate'],  1, 0]],
          cnt_health:   ['+', ['case', ['==', ['get', 'domain'], 'health'],   1, 0]],
          cnt_conflict: ['+', ['case', ['==', ['get', 'domain'], 'conflict'], 1, 0]],
          cnt_economic: ['+', ['case', ['==', ['get', 'domain'], 'economic'], 1, 0]],
          cnt_labor:    ['+', ['case', ['==', ['get', 'domain'], 'labor'],    1, 0]],
          cnt_science:  ['+', ['case', ['==', ['get', 'domain'], 'science'],  1, 0]],
          // Weighted so a pile of cyber claims doesn't out-vote earthquakes/conflict for colour
          cnt_cyber:    ['+', ['case', ['==', ['get', 'domain'], 'cyber'],    CYBER_WEIGHT, 0]],
          w:            ['+', ['get', 'weight']], // weighted size of the cluster
        },
      });

      // ── Cluster circles ──────────────────────────────────
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          // Color = dominant domain inside the cluster
          'circle-color': CLUSTER_COLOR_EXPR as maplibregl.ExpressionSpecification,
          'circle-radius': [
            'step',
            ['get', 'w'],
            18,
            10, 24,
            30, 32,
          ],
          'circle-opacity': 0.85,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#1f2937',
        },
      });

      // ── Cluster count labels ─────────────────────────────
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Regular'], // exists on both CARTO's and the fallback glyph servers
          'text-size': 12,
          // On the globe, symbols are only culled when they're beyond the horizon if overlap
          // checking is on; with allow-overlap the far-side counts floated in space.
          'text-allow-overlap': false,
          'text-ignore-placement': true, // but never let these counts bump other labels
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.3)',
          'text-halo-width': 1,
        },
      });

      // ── Individual event circles ─────────────────────────
      map.addLayer({
        id: LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['get', 'radius'],
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(0,0,0,0.5)',
          // Subtle glow effect via outer ring
          'circle-blur': 0.1,
        },
      });

      // ── Hover highlight layer ─────────────────────────────
      map.addLayer({
        id: `${LAYER_ID}-hover`,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', 'id', ''],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['*', ['get', 'radius'], 1.6],
          'circle-opacity': 0.4,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      // ── Hover: show popup + highlight on mousemove ───────
      map.on('mouseenter', LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mousemove', LAYER_ID, e => {
        if (!e.features || !e.features[0]) return;
        const props = e.features[0].properties as PopupProps;
        // Highlight ring
        map.setFilter(`${LAYER_ID}-hover`, ['==', 'id', props.id ?? '']);
        // Show or update hover popup (no close button, no click needed)
        if (!popupRef.current) {
          popupRef.current = new maplibregl.Popup({
            maxWidth: '300px',
            offset: 14,
            closeButton: false,
            closeOnClick: false,
            className: 'vigil-hover-popup',
          }).addTo(map);
        }
        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(renderPopup(props));
      });
      map.on('mouseleave', LAYER_ID, () => {
        map.getCanvas().style.cursor = '';
        map.setFilter(`${LAYER_ID}-hover`, ['==', 'id', '']);
        if (popupRef.current) {
          popupRef.current.remove();
          popupRef.current = null;
        }
      });
      // ── Click: select event in sidebar + fly to it ───────
      map.on('click', LAYER_ID, e => {
        if (!e.features || !e.features[0]) return;
        const props = e.features[0].properties as PopupProps;
        const ev = eventsRef.current.find(v => v.id === props.id);
        if (ev && onEventClick) onEventClick(ev);
      });

      // Expand cluster on click
      map.on('click', 'clusters', e => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        if (!features[0]) return;
        const clusterId = features[0].properties?.cluster_id;
        (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource)
          .getClusterExpansionZoom(clusterId)
          .then((zoom: number) => {
            map.easeTo({
              center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
              zoom,
            });
          })
          .catch(() => { /* ignore */ });
      });

      map.on('mouseenter', 'clusters', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'clusters', () => {
        map.getCanvas().style.cursor = '';
      });
    });

    mapRef.current = map;

    return () => {
      (map as any)._vigilCleanup?.();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update GeoJSON source when events change ─────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(eventsToGeoJSON(events));
    }
  }, [events]);

  // ── Fly to a specific event ──────────────────────────────
  const flyTo = useCallback((lat: number, lng: number, zoom = 5) => {
    const map = mapRef.current;
    if (!map) return;
    // Stop any active rotation and restart the idle timer
    (map as any)._vigilResetIdle?.();
    map.flyTo({ center: [lng, lat], zoom, duration: 1200, essential: true });
  }, []);

  // Frame a set of points (used when drilling into a cyber trend). Handles 0/1/many points.
  const fitPoints = useCallback((points: Array<[number, number]>) => {
    const map = mapRef.current;
    if (!map || points.length === 0) return;
    (map as unknown as { _vigilResetIdle?: () => void })._vigilResetIdle?.();
    if (points.length === 1) {
      map.flyTo({ center: points[0], zoom: 3.5, duration: 1200, essential: true });
      return;
    }
    const bounds = points.reduce(
      (b, p) => b.extend(p),
      new maplibregl.LngLatBounds(points[0], points[0]),
    );
    // maxZoom 3.5 keeps a whole country in view; claims sit at a country-centroid anyway.
    map.fitBounds(bounds, { padding: 80, maxZoom: 3.5, duration: 1200, essential: true });
  }, []);

  // Expose flyTo + resetIdle on the DOM node for parent components
  useEffect(() => {
    if (containerRef.current) {
      (containerRef.current as HTMLElement & {
        __fitPoints?: (points: Array<[number, number]>) => void;
      }).__fitPoints = fitPoints;
      // @ts-ignore
      containerRef.current.__flyTo = flyTo;
      // @ts-ignore
      containerRef.current.__resetIdle = () => {
        (mapRef.current as any)?._vigilResetIdle?.();
      };
    }
  }, [flyTo, fitPoints]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
      aria-label="VigilMap interactive globe"
    />
  );
}

export default Globe;
