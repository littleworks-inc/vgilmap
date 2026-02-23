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

// Free tile style from Stadia Maps (no API key for low traffic)
const MAP_STYLE =
  'https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json';

// Fallback: public style from MapLibre demo (no key needed)
const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm-tiles',
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
      },
    })),
  };
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
        const props = e.features[0].properties!;
        const ev = eventsRef.current.find(v => v.id === props.id);

        const mag = typeof props.magnitude === 'number' ? props.magnitude : 0;

        // Show popup
        if (popupRef.current) popupRef.current.remove();
        popupRef.current = new maplibregl.Popup({ maxWidth: '280px', offset: 12 })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:sans-serif;font-size:13px;line-height:1.5;color:#111;">
              <strong style="font-size:14px;">${props.title ?? 'Event'}</strong><br/>
              ${mag ? `<span style="color:#ef4444;font-weight:600;">M${Number(mag).toFixed(1)}</span> · ` : ''}
              <span style="color:#6b7280;">${new Date(props.timestamp).toLocaleString()}</span><br/>
              <span>${props.description ?? ''}</span><br/>
              ${props.sourceUrl ? `<a href="${props.sourceUrl}" target="_blank" rel="noopener" style="color:#3b82f6;">USGS details ↗</a>` : ''}
            </div>`
          )
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

    // Fallback: if style 404s, load OSM
    map.on('styleerror', () => {
      console.warn('Globe: primary style failed, falling back to OSM');
      map.setStyle(FALLBACK_STYLE as maplibregl.StyleSpecification);
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
