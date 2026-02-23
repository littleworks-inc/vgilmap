/**
 * App.tsx
 *
 * Root component for VigilMap.
 * Layout: [Sidebar | Globe (full height)]
 *
 * Data lifecycle:
 *  - Fetches USGS earthquakes on mount
 *  - Auto-refreshes every 5 minutes
 *  - Clicking a sidebar row flies the map to that event
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Globe } from './map/Globe';
import { Sidebar } from './components/Sidebar';
import { fetchUSGSEarthquakes } from './adapters/usgs';
import type { VigilEvent } from './types';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export default function App() {
  const [events, setEvents] = useState<VigilEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const globeContainerRef = useRef<HTMLDivElement>(null);

  // ── Data fetch ───────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUSGSEarthquakes();
      // Sort newest first
      data.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEvents(data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch USGS data:', err);
      setError('Could not load USGS data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + auto-refresh
  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  // ── Fly to event when sidebar row is clicked ─────────────
  const handleSelectEvent = useCallback((ev: VigilEvent) => {
    setSelectedId(ev.id);

    // Use the __flyTo helper exposed on the globe container div
    const container = globeContainerRef.current?.querySelector(
      '[aria-label="VigilMap interactive globe"]'
    ) as HTMLElement | null;
    if (container && typeof (container as HTMLElement & { __flyTo?: Function }).__flyTo === 'function') {
      (container as HTMLElement & { __flyTo: Function }).__flyTo(
        ev.location.lat,
        ev.location.lng,
        6
      );
    }
  }, []);

  const handleEventClickOnMap = useCallback((ev: VigilEvent) => {
    setSelectedId(ev.id);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: '#0a0f1e',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* ── Sidebar ────────────────────────────────────────── */}
      <Sidebar
        events={events}
        selectedId={selectedId}
        loading={loading}
        error={error}
        lastUpdated={lastUpdated}
        onSelectEvent={handleSelectEvent}
        onRefresh={load}
      />

      {/* ── Map area ───────────────────────────────────────── */}
      <div ref={globeContainerRef} style={{ flex: 1, position: 'relative' }}>
        <Globe events={events} onEventClick={handleEventClickOnMap} />

        {/* Loading overlay */}
        {loading && events.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(10,15,30,0.7)',
              color: '#94a3b8',
              fontSize: '14px',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🌍</div>
              <div>Loading live earthquake data…</div>
            </div>
          </div>
        )}

        {/* Live event count pill */}
        {events.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              background: 'rgba(10,15,30,0.85)',
              border: '1px solid #1e293b',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '12px',
              color: '#94a3b8',
              backdropFilter: 'blur(4px)',
              zIndex: 5,
              pointerEvents: 'none',
            }}
          >
            <span style={{ color: '#22c55e', marginRight: '6px' }}>●</span>
            <strong style={{ color: '#e2e8f0' }}>{events.length}</strong> earthquakes in last 24h
            {lastUpdated && (
              <span style={{ marginLeft: '8px', color: '#475569' }}>
                · {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
