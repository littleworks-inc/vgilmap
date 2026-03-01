/**
 * App.tsx — VigilMap root component
 *
 * Layout:  [Sidebar | DomainFilter + Globe]
 *
 * Data:
 *  - Fetches all adapters in parallel on mount
 *  - De-duplicates events by id across adapters
 *  - Auto-refreshes every 5 minutes
 *  - Domain filter controls which events reach Globe + Sidebar
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Globe } from './map/Globe';
import { Sidebar } from './components/Sidebar';
import { DomainFilter } from './components/DomainFilter';
import { LiveTicker } from './components/LiveTicker';
import { AnimatedCount } from './components/AnimatedCount';
import { useIsMobile } from './hooks/useIsMobile';
import { MobileDrawer } from './components/MobileDrawer';
import { fetchUSGSEarthquakes } from './adapters/usgs';
import { fetchUSGSSignificantWeek } from './adapters/usgs-significant-week';
import { fetchNASAFirms } from './adapters/nasa-firms';
import { fetchNOAAAlerts } from './adapters/noaa';
import { fetchGDELT } from './adapters/gdelt';
import { fetchWHOOutbreaks } from './adapters/who';
import type { Domain, VigilEvent } from './types';
import { DOMAIN_ICONS } from './types';
import { detectAnomalies } from './intelligence/anomaly';
import type { AnomalySignal } from './intelligence/anomaly';

// ─── Constants ─────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const ALL_DOMAINS: Domain[] = [
  'disaster', 'climate', 'health', 'conflict', 'economic', 'labor', 'science',
];

// ─── Adapter registry ──────────────────────────────────────

const ADAPTERS: Array<{
  key: string;
  label: string;
  fetch: () => Promise<VigilEvent[]>;
}> = [
  { key: 'usgs-day',   label: 'USGS 24h',        fetch: fetchUSGSEarthquakes },
  { key: 'usgs-week',  label: 'USGS Significant', fetch: fetchUSGSSignificantWeek },
  { key: 'nasa-firms', label: 'NASA FIRMS',        fetch: fetchNASAFirms },
  { key: 'noaa',       label: 'NOAA Alerts',       fetch: fetchNOAAAlerts },
  { key: 'gdelt',      label: 'GDELT Conflict',     fetch: fetchGDELT },
  { key: 'who',        label: 'WHO Outbreaks',     fetch: fetchWHOOutbreaks },
];

// ─── Helpers ───────────────────────────────────────────────

function mergeEvents(arrays: VigilEvent[][]): VigilEvent[] {
  const seen = new Set<string>();
  const result: VigilEvent[] = [];
  for (const arr of arrays) {
    for (const ev of arr) {
      if (!seen.has(ev.id)) {
        seen.add(ev.id);
        result.push(ev);
      }
    }
  }
  return result;
}

function countByDomain(events: VigilEvent[]): Partial<Record<Domain, number>> {
  const counts: Partial<Record<Domain, number>> = {};
  for (const ev of events) {
    counts[ev.domain] = (counts[ev.domain] ?? 0) + 1;
  }
  return counts;
}

function domainLabel(domain: Domain, count: number): string {
  const labels: Record<Domain, [string, string]> = {
    disaster: ['earthquake', 'earthquakes'],
    climate:  ['event', 'events'],
    health:   ['alert', 'alerts'],
    conflict: ['incident', 'incidents'],
    economic: ['indicator', 'indicators'],
    labor:    ['event', 'events'],
    science:  ['paper', 'papers'],
  };
  const [singular, plural] = labels[domain];
  return count === 1 ? singular : plural;
}

// ─── Per-domain count pill ─────────────────────────────────

function DomainCountPill({
  events,
  lastUpdated,
}: {
  events: VigilEvent[];
  lastUpdated: Date | null;
}) {
  const counts = useMemo(() => countByDomain(events), [events]);

  const active = (Object.entries(counts) as [Domain, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  if (active.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '48px',
        left: '12px',
        background: 'rgba(10,15,30,0.88)',
        border: '1px solid #1e293b',
        borderRadius: '10px',
        padding: '7px 12px',
        fontSize: '12px',
        color: '#94a3b8',
        backdropFilter: 'blur(6px)',
        zIndex: 5,
        pointerEvents: 'none',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px',
        maxWidth: '480px',
        lineHeight: 1.6,
      }}
    >
      {active.map(([domain, count]) => (
        <span key={domain} style={{ whiteSpace: 'nowrap' }}>
          <span>{DOMAIN_ICONS[domain]}</span>{' '}
          <strong style={{ color: '#e2e8f0' }} className="vigil-count">
            <AnimatedCount value={count} />
          </strong>{' '}
          <span style={{ color: '#64748b' }}>{domainLabel(domain, count)}</span>
        </span>
      ))}
      {lastUpdated && (
        <span style={{ color: '#334155', borderLeft: '1px solid #1e293b', paddingLeft: '10px' }}>
          {lastUpdated.toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}

// ─── Root component ────────────────────────────────────────

export default function App() {
  const [allEvents, setAllEvents]       = useState<VigilEvent[]>([]);
  const [loading, setLoading]           = useState(true);
  const [errors, setErrors]             = useState<string[]>([]);
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null);
  const [selectedId, setSelectedId]     = useState<string | undefined>();
  const [activeDomains, setActiveDomains] = useState<Set<Domain>>(new Set(ALL_DOMAINS));

  const globeContainerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // ── Fetch all adapters in parallel ──────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);

    const results = await Promise.allSettled(ADAPTERS.map(a => a.fetch()));

    const arrays: VigilEvent[][] = [];
    const errs: string[] = [];

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        arrays.push(result.value);
      } else {
        console.error(`[${ADAPTERS[i].label}] failed:`, result.reason);
        errs.push(ADAPTERS[i].label);
      }
    });

    if (errs.length) setErrors(errs);

    const merged = mergeEvents(arrays);
    merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    setAllEvents(merged);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  // ── Domain filter ────────────────────────────────────────
  const toggleDomain = useCallback((domain: Domain) => {
    setActiveDomains(prev => {
      const next = new Set(prev);
      next.has(domain) ? next.delete(domain) : next.add(domain);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setActiveDomains(new Set(ALL_DOMAINS)), []);
  const clearAll  = useCallback(() => setActiveDomains(new Set()), []);

  // ── Derived state ────────────────────────────────────────
  const filteredEvents = useMemo(
    () => allEvents.filter(ev => activeDomains.has(ev.domain)),
    [allEvents, activeDomains]
  );

  const anomalySignals = useMemo(
    () => detectAnomalies(filteredEvents),
    [filteredEvents]
  );

  const domainCounts = useMemo(() => countByDomain(allEvents), [allEvents]);

  const errorMsg = errors.length > 0 ? `${errors.join(', ')} failed` : null;

  // ── Fly to event ─────────────────────────────────────────
  const flyToEvent = useCallback((ev: VigilEvent) => {
    const container = globeContainerRef.current?.querySelector(
      '[aria-label="VigilMap interactive globe"]'
    ) as (HTMLElement & { __flyTo?: (lat: number, lng: number, zoom: number) => void }) | null;
    container?.__flyTo?.(ev.location.lat, ev.location.lng, 6);
  }, []);

  const handleSelectEvent = useCallback((ev: VigilEvent) => {
    setSelectedId(ev.id);
    flyToEvent(ev);
  }, [flyToEvent]);

  const handleEventClickOnMap = useCallback((ev: VigilEvent) => {
    setSelectedId(ev.id);
  }, []);

  const handleSelectSignal = useCallback((signal: AnomalySignal) => {
    const container = globeContainerRef.current?.querySelector(
      '[aria-label="VigilMap interactive globe"]'
    ) as (HTMLElement & {
      __flyTo?: (lat: number, lng: number, zoom: number) => void
    }) | null;
    container?.__flyTo?.(signal.lat, signal.lng, 4);
  }, []);

  // ── Render ───────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      background: '#0a0f1e',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Desktop sidebar — hidden on mobile */}
      {!isMobile && (
        <Sidebar
          events={filteredEvents}
          selectedId={selectedId}
          loading={loading}
          error={errorMsg}
          lastUpdated={lastUpdated}
          onSelectEvent={handleSelectEvent}
          onRefresh={load}
          anomalySignals={anomalySignals}
          onSelectSignal={handleSelectSignal}
        />
      )}

      {/* Map pane — full screen on mobile */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <DomainFilter
          activeDomains={activeDomains}
          counts={domainCounts}
          onToggle={toggleDomain}
          onSelectAll={selectAll}
          onClearAll={clearAll}
        />

        <div ref={globeContainerRef} style={{ flex: 1, position: 'relative' }}>
          <Globe events={filteredEvents} onEventClick={handleEventClickOnMap} />

          {/* Loading overlay */}
          {loading && allEvents.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(10,15,30,0.75)', color: '#94a3b8',
              fontSize: '14px', pointerEvents: 'none', zIndex: 10,
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '36px', marginBottom: '10px' }}>🌍</div>
                <div>Loading global intelligence data…</div>
                <div style={{ fontSize: '11px', color: '#475569', marginTop: '6px' }}>
                  USGS · NASA FIRMS · NOAA · GDELT · WHO
                </div>
              </div>
            </div>
          )}

          {/* Count pill — raise above drawer on mobile */}
          <DomainCountPill events={filteredEvents} lastUpdated={lastUpdated} />

          {/* Live ticker — desktop only (drawer replaces it on mobile) */}
          {!isMobile && (
            <LiveTicker events={filteredEvents} onSelectEvent={handleSelectEvent} />
          )}

          {/* Error badge */}
          {errors.length > 0 && !loading && (
            <div style={{
              position: 'absolute', top: '12px', left: '12px',
              background: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444',
              borderRadius: '8px', padding: '5px 10px',
              fontSize: '11px', color: '#fca5a5',
              zIndex: 5, pointerEvents: 'none',
            }}>
              ⚠ {errors.join(', ')} unavailable
            </div>
          )}
        </div>
      </div>

      {/* Mobile bottom drawer — replaces sidebar on small screens */}
      {isMobile && (
        <MobileDrawer
          events={filteredEvents}
          selectedId={selectedId}
          loading={loading}
          error={errorMsg}
          lastUpdated={lastUpdated}
          onSelectEvent={handleSelectEvent}
          onRefresh={load}
          anomalySignals={anomalySignals}
          onSelectSignal={handleSelectSignal}
        />
      )}
    </div>
  );
}
