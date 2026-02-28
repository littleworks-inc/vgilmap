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
import { earthquakeColor, earthquakeRadius, DOMAIN_COLORS } from '../types';

// ─── constants ─────────────────────────────────────────────

const LAYER_ID = 'vigil-events';
const SOURCE_ID = 'vigil-events';

// Inline copies of domain/severity maps — popup HTML is a plain string,
// can't reference module-level imports at serialization time.
const POPUP_DOMAIN_COLORS: Record<string, string> = {
  disaster: '#ef4444', climate: '#f97316', health: '#ec4899',
  conflict: '#7c3aed', economic: '#eab308', labor: '#3b82f6', science: '#10b981',
};
const POPUP_DOMAIN_ICONS: Record<string, string> = {
  disaster: '🌋', climate: '🌡️', health: '🏥',
  conflict: '⚔️', economic: '💰', labor: '✊', science: '🔬',
};
const POPUP_SEVERITY_COLORS: Record<string, string> = {
  critical: '#7c3aed', high: '#ef4444', medium: '#f97316',
  low: '#facc15', info: '#6b7280',
};

// CartoDB Dark Matter — free vector tiles, no API key required.
// © CartoDB, © OpenStreetMap contributors
const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    'carto-tiles': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© <a href="https://carto.com">CartoDB</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'carto-tiles',
      type: 'raster',
      source: 'carto-tiles',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

// ─── helpers ───────────────────────────────────────────────

function eventsToGeoJSON(
  events: VigilEvent[]
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: events.map(ev => ({
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
          : ev.severity === 'critical' ? 10
          : ev.severity === 'high' ? 8
          : ev.severity === 'medium' ? 6
          : 5,
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
      style: MAP_STYLE,
      center: [0, 20],
      zoom: 1.8,
      minZoom: 1,
      maxZoom: 18,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-right');

    // ── Add source + layer when style loads ───────────────
    map.on('load', () => {
      // If style failed, fall back to OSM raster
      if (!map.getLayer('background') && !map.getSource('osm-tiles')) {
        // Nothing special needed here — FALLBACK_STYLE handles it
      }

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: eventsToGeoJSON(eventsRef.current),
        cluster: true,
        clusterMaxZoom: 5,
        clusterRadius: 40,
      });

      // ── Cluster circles ──────────────────────────────────
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#f97316',   // orange  < 10
            10, '#ef4444',  // red    10-30
            30, '#7c3aed',  // purple 30+
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
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
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 12,
        },
        paint: {
          'text-color': '#ffffff',
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
          'circle-opacity': 0.9,
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

      // Pointer cursor on hover
      map.on('mouseenter', LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', LAYER_ID, () => {
        map.getCanvas().style.cursor = '';
        map.setFilter(`${LAYER_ID}-hover`, ['==', 'id', '']);
      });

      // Highlight on hover
      map.on('mousemove', LAYER_ID, e => {
        if (e.features && e.features[0]) {
          const id = e.features[0].properties?.id ?? '';
          map.setFilter(`${LAYER_ID}-hover`, ['==', 'id', id]);
        }
      });

      // ── Click handler ────────────────────────────────────
      map.on('click', LAYER_ID, e => {
        if (!e.features || !e.features[0]) return;
        const props = e.features[0].properties as PopupProps;
        const ev = eventsRef.current.find(v => v.id === props.id);

        if (popupRef.current) popupRef.current.remove();
        popupRef.current = new maplibregl.Popup({ maxWidth: '300px', offset: 12 })
          .setLngLat(e.lngLat)
          .setHTML(renderPopup(props))
          .addTo(map);

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
    mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1000 });
  }, []);

  // Expose flyTo on the DOM node for parent components
  useEffect(() => {
    if (containerRef.current) {
      // @ts-ignore
      containerRef.current.__flyTo = flyTo;
    }
  }, [flyTo]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
      aria-label="VigilMap interactive globe"
    />
  );
}

export default Globe;
