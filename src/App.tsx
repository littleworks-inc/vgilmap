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
import { fetchReliefWeb } from './adapters/reliefweb';
import { fetchGDELTEconomic } from './adapters/gdelt-economic';
import type { Domain, VigilEvent } from './types';
import { DOMAIN_ICONS, DOMAIN_COLORS } from './types';
import { detectAnomalies } from './intelligence/anomaly';
import type { AnomalySignal } from './intelligence/anomaly';

// ─── Constants ─────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const ALL_DOMAINS: Domain[] = [
  'disaster', 'climate', 'health', 'conflict', 'economic', 'labor', 'science',
];

const DOMAIN_LABELS: Record<Domain, string> = {
  disaster: 'Earthquakes',
  climate:  'Climate',
  health:   'Health',
  conflict: 'Conflict',
  economic: 'Economic',
  labor:    'Labor',
  science:  'Science',
};

// ─── URL helpers ───────────────────────────────────────────

function getEventIdFromURL(): string | null {
  return new URLSearchParams(window.location.search).get('event');
}

function pushEventToURL(id: string | undefined) {
  const url = new URL(window.location.href);
  if (id) { url.searchParams.set('event', id); }
  else     { url.searchParams.delete('event'); }
  history.replaceState(null, '', url.toString());
}

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
  { key: 'who',        label: 'WHO Outbreaks',   fetch: fetchWHOOutbreaks },
  { key: 'reliefweb',  label: 'ReliefWeb',        fetch: fetchReliefWeb },
  { key: 'gdelt-econ', label: 'GDELT Economic',   fetch: fetchGDELTEconomic },
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

// ─── Map legend + live count pill ──────────────────────────

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
        background: 'rgba(10,15,30,0.92)',
        border: '1px solid #1e293b',
        borderRadius: '10px',
        backdropFilter: 'blur(8px)',
        zIndex: 5,
        pointerEvents: 'none',
        minWidth: '160px',
        overflow: 'hidden',
      }}
    >
      {/* ── Legend header ── */}
      <div style={{
        padding: '6px 12px',
        borderBottom: '1px solid #1e293b',
        fontSize: '9px',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase' as const,
        color: '#334155',
      }}>
        Map Legend
      </div>
      {/* ── Domain rows ── */}
      <div style={{ padding: '6px 0' }}>
        {active.map(([domain, count]) => (
          <div key={domain} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '3px 12px',
          }}>
            {/* Color swatch */}
            <span style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: DOMAIN_COLORS[domain],
              flexShrink: 0,
              boxShadow: `0 0 5px ${DOMAIN_COLORS[domain]}88`,
            }} />
            {/* Icon + label */}
            <span style={{ fontSize: '12px', color: '#94a3b8', flex: 1 }}>
              {DOMAIN_ICONS[domain]} {DOMAIN_LABELS[domain]}
            </span>
            {/* Count */}
            <span style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#e2e8f0',
              fontVariantNumeric: 'tabular-nums',
            }}>
              <AnimatedCount value={count} />
            </span>
          </div>
        ))}
      </div>
      {/* ── Earthquake magnitude sub-legend ── */}
      {(counts['disaster'] ?? 0) > 0 && (
        <div style={{
          borderTop: '1px solid #1e293b',
          padding: '6px 12px',
        }}>
          <div style={{
            fontSize: '9px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase' as const,
            color: '#334155',
            marginBottom: '4px',
          }}>
            Magnitude
          </div>
          {[
            { color: '#ef4444', label: 'M5+  major' },
            { color: '#f97316', label: 'M3–5 moderate' },
            { color: '#facc15', label: 'M<3  minor' },
          ].map(({ color, label }) => (
            <div key={label} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '2px 0',
            }}>
              <span style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: color,
                flexShrink: 0,
                boxShadow: `0 0 4px ${color}88`,
              }} />
              <span style={{ fontSize: '11px', color: '#64748b' }}>{label}</span>
            </div>
          ))}
        </div>
      )}
      {/* ── Last updated ── */}
      {lastUpdated && (
        <div style={{
          borderTop: '1px solid #1e293b',
          padding: '5px 12px',
          fontSize: '10px',
          color: '#334155',
          fontVariantNumeric: 'tabular-nums',
        }}>
          ● Updated {lastUpdated.toLocaleTimeString()}
        </div>
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
  const [selectedId, setSelectedId]     = useState<string | undefined>(getEventIdFromURL() ?? undefined);
  const [activeDomains, setActiveDomains] = useState<Set<Domain>>(new Set(ALL_DOMAINS));

  const globeContainerRef = useRef<HTMLDivElement>(null);
  const hasDeepLinked     = useRef(false);
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

  // ── Deep-link: fly to event from URL on first load ───────
  useEffect(() => {
    if (hasDeepLinked.current) return;
    if (!selectedId || allEvents.length === 0) return;
    const ev = allEvents.find(e => e.id === selectedId);
    if (!ev) return;
    hasDeepLinked.current = true;
    flyToEvent(ev);
  }, [allEvents, selectedId, flyToEvent]);

  const handleSelectEvent = useCallback((ev: VigilEvent) => {
    setSelectedId(ev.id);
    pushEventToURL(ev.id);
    flyToEvent(ev);
  }, [flyToEvent]);

  const handleEventClickOnMap = useCallback((ev: VigilEvent) => {
    setSelectedId(ev.id);
    pushEventToURL(ev.id);
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
