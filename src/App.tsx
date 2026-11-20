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
import { usePersistedBool } from './hooks/usePersistedBool';
import { MobileDrawer } from './components/MobileDrawer';
import { fetchUSGSEarthquakes } from './adapters/usgs';
import { fetchUSGSSignificantWeek } from './adapters/usgs-significant-week';
import { fetchNASAFirms } from './adapters/nasa-firms';
import { fetchNOAAAlerts } from './adapters/noaa';
import { fetchGDELT, fetchConflictNews } from './adapters/gdelt';
import { fetchWHOOutbreaks } from './adapters/who';
import { fetchReliefWeb } from './adapters/reliefweb';
import { fetchEconomicNews } from './adapters/economic-news';
import { fetchScience } from './adapters/science';
import { fetchCyber } from './adapters/cyber';
import { fetchCyberBreaches } from './adapters/cyber-breaches';
import { fetchCyberNews } from './adapters/cyber-news';
import type { CyberFocus, Domain, TimeWindowId, VigilEvent } from './types';
import { DOMAIN_ICONS, DOMAIN_COLORS, DEFAULT_TIME_WINDOW, isMappable, matchesCyberFocus, timeWindowMs } from './types';
import { detectAnomalies } from './intelligence/anomaly';
import { classify } from './health/sourceHealth';
import type { SourceHealth } from './health/sourceHealth';
import { clearWarnings, getWarnings } from './adapters/source-warnings';
import type { AnomalySignal } from './intelligence/anomaly';

// ─── Constants ─────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const ALL_DOMAINS: Domain[] = [
  'disaster', 'climate', 'health', 'conflict', 'economic', 'labor', 'science', 'cyber',
];

const DOMAIN_LABELS: Record<Domain, string> = {
  disaster: 'Earthquakes',
  climate:  'Climate',
  health:   'Health',
  conflict: 'Conflict',
  economic: 'Economic',
  labor:    'Labor',
  science:  'Science',
  cyber:    'Cyber',
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

// `staleAfterHours`: if the newest event is older than this, the source is flagged "stale"
// in the Data Health panel (it responds, but isn't producing current data).
const ADAPTERS: Array<{
  key: string;
  label: string;
  domain: Domain;
  staleAfterHours: number;
  /** An extra on top of other sources: if it fails it's shown in Data Health, but raises no banner. */
  optional?: boolean;
  fetch: () => Promise<VigilEvent[]>;
}> = [
  { key: 'usgs-day',   label: 'USGS 24h',        domain: 'disaster', staleAfterHours: 3,   fetch: fetchUSGSEarthquakes },
  { key: 'usgs-week',  label: 'USGS Significant', domain: 'disaster', staleAfterHours: 168, fetch: fetchUSGSSignificantWeek },
  { key: 'nasa-firms', label: 'NASA FIRMS',        domain: 'climate',  staleAfterHours: 24,  fetch: fetchNASAFirms },
  { key: 'noaa',       label: 'NOAA Alerts',       domain: 'climate',  staleAfterHours: 12,  fetch: fetchNOAAAlerts },
  { key: 'conflict-rss', label: 'Conflict News (RSS)', domain: 'conflict', staleAfterHours: 12, fetch: fetchConflictNews },
  { key: 'gdelt',      label: 'GDELT Conflict',    domain: 'conflict', staleAfterHours: 24,  optional: true, fetch: fetchGDELT },
  { key: 'who',        label: 'WHO Outbreak News', domain: 'health',   staleAfterHours: 720, fetch: fetchWHOOutbreaks },
  { key: 'reliefweb',  label: 'ReliefWeb Disasters', domain: 'disaster', staleAfterHours: 1080, fetch: fetchReliefWeb },
  { key: 'economic-news', label: 'Economic & Labor News', domain: 'economic', staleAfterHours: 24, fetch: fetchEconomicNews },
  { key: 'science',    label: 'NASA Space Weather', domain: 'science', staleAfterHours: 168, fetch: fetchScience },
  { key: 'cyber',      label: 'Ransomware & KEV',  domain: 'cyber',    staleAfterHours: 72,  fetch: fetchCyber },
  { key: 'cyber-breaches', label: 'Data Breaches (HIBP)', domain: 'cyber', staleAfterHours: 504, fetch: fetchCyberBreaches },
  { key: 'cyber-news', label: 'Cyber Incident News', domain: 'cyber',  staleAfterHours: 24,  fetch: fetchCyberNews },
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
  // `events` is everything currently in view (same set the top chips count). The legend shows how
  // many of those are actually plotted: events with no real location (CISA KEV, solar flares,
  // regional WHO notices, most breach/news items) are list-only, so "of N" explains the gap.
  const [open, setOpen] = usePersistedBool('vigil.legend.open', true);
  const totals = useMemo(() => countByDomain(events), [events]);
  const onMap = useMemo(() => countByDomain(events.filter(isMappable)), [events]);
  const counts = onMap;
  const hasListOnly = (Object.keys(totals) as Domain[]).some(d => (totals[d] ?? 0) > (onMap[d] ?? 0));
  const active = (Object.entries(totals) as [Domain, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => (onMap[b[0]] ?? 0) - (onMap[a[0]] ?? 0) || b[1] - a[1]);
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
        // Must catch the mouse: with `pointer-events: none`, clicking or dragging the legend fell
        // through to the globe underneath and rotated/selected things on the map.
        pointerEvents: 'auto',
        userSelect: 'none',
        minWidth: '160px',
        maxWidth: '210px', // the footnote must wrap, not stretch the legend across the map
        overflow: 'hidden',
      }}
    >
      {/* ── Legend header (click to collapse so it doesn't cover the globe) ── */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        title={open ? 'Collapse legend' : 'Expand legend'}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
        style={{
          padding: '6px 12px',
          borderBottom: open ? '1px solid #1e293b' : 'none',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase' as const,
          color: '#7d8ba1',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <span>Map Legend</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </div>
      {open && (<>
      {/* ── Domain rows ── */}
      <div style={{ padding: '6px 0' }}>
        {active.map(([domain, total]) => {
          const count = onMap[domain] ?? 0;
          return (
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
              {total > count && <span style={{ color: '#7d8ba1', fontWeight: 500 }}> of {total}</span>}
            </span>
          </div>
          );
        })}
        {hasListOnly && (
          <div style={{ padding: '4px 12px 0', fontSize: '9px', color: '#7d8ba1', lineHeight: 1.35 }}>
            “of N” = total in view; the rest have no map location and appear in the list only.
          </div>
        )}
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
              <span style={{ fontSize: '11px', color: '#8a99ae' }}>{label}</span>
            </div>
          ))}
        </div>
      )}
      </>)}
      {/* ── Last updated ── */}
      {open && lastUpdated && (
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
  const loadRunRef        = useRef(0);
  const [cyberFocus, setCyberFocus] = useState<CyberFocus | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindowId>(DEFAULT_TIME_WINDOW);
  const [sourceHealth, setSourceHealth] = useState<SourceHealth[]>(() =>
    ADAPTERS.map(a => ({
      key: a.key, label: a.label, domain: a.domain, status: 'loading' as const, count: 0, warnings: [], startedAt: Date.now(), optional: a.optional,
    })),
  );
  const lastOkRef = useRef<Map<string, number>>(new Map());
  // Which events each source returned, so Data Health can show how many are in the current view.
  const [sourceIds, setSourceIds] = useState<Record<string, string[]>>({});
  const isMobile = useIsMobile();

  // ── Fetch all adapters in parallel ──────────────────────
  const load = useCallback(async () => {
    const runId = ++loadRunRef.current;
    setLoading(true);
    setErrors([]);

    // Render progressively: each source updates the map the moment it returns, so one
    // slow source (GDELT can take 20s+) never blocks the fast ones (~1s).
    const bySource: Array<VigilEvent[] | undefined> = new Array(ADAPTERS.length);
    const errs: string[] = [];

    const publish = () => {
      const merged = mergeEvents(bySource.filter((a): a is VigilEvent[] => !!a));
      merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setAllEvents(merged);
      setLastUpdated(new Date());
    };

    await Promise.allSettled(
      ADAPTERS.map(async (adapter, i) => {
        const startedAt = performance.now();
        clearWarnings(adapter.key);
        let patch: Partial<SourceHealth>;
        try {
          const events = await adapter.fetch();
          bySource[i] = events;
          if (runId === loadRunRef.current) setSourceIds(prev => ({ ...prev, [adapter.key]: events.map(e => e.id) }));
          const now = Date.now();
          const warnings = getWarnings(adapter.key);
          const { status, newestAt } = classify(events, adapter.staleAfterHours, warnings, now);
          if (events.length > 0) lastOkRef.current.set(adapter.key, now);
          patch = { status, newestAt, count: events.length, warnings, error: undefined };
        } catch (reason) {
          console.error(`[${adapter.label}] failed:`, reason);
          if (!adapter.optional) errs.push(adapter.label); // optional extras fail quietly
          patch = {
            status: 'error', count: 0, newestAt: undefined, warnings: [],
            error: reason instanceof Error ? reason.message : String(reason),
          };
        }
        if (runId === loadRunRef.current) {
          const done = { ...patch, durationMs: Math.round(performance.now() - startedAt), checkedAt: Date.now(), lastOkAt: lastOkRef.current.get(adapter.key) };
          setSourceHealth(prev => prev.map(h => (h.key === adapter.key ? { ...h, ...done } : h)));
        }
        if (runId !== loadRunRef.current) return; // a newer refresh superseded this one
        if (errs.length) setErrors([...errs]);
        publish();
        // Overlay goes away as soon as any source has events to show.
        if (bySource.some(a => a && a.length > 0)) setLoading(false);
      })
    );
    // All sources settled: make sure the overlay is gone even if everything was empty.
    if (runId === loadRunRef.current) setLoading(false);
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
  // Time window first: sources mix ages (live quakes, multi-day ransomware claims, even
  // years-old archive items), so cap everything to the selected window. Measured from the
  // last refresh time so this stays a pure function of state.
  const windowedEvents = useMemo(() => {
    if (!lastUpdated) return allEvents;
    const cutoff = lastUpdated.getTime() - timeWindowMs(timeWindow);
    return allEvents.filter(ev => new Date(ev.timestamp).getTime() >= cutoff);
  }, [allEvents, lastUpdated, timeWindow]);

  const filteredEvents = useMemo(() => {
    const byDomain = windowedEvents.filter(ev => activeDomains.has(ev.domain));
    // Drill-down from the Cyber Trends panel: show only the matching ransomware claims.
    return cyberFocus ? byDomain.filter(ev => matchesCyberFocus(ev, cyberFocus)) : byDomain;
  }, [windowedEvents, activeDomains, cyberFocus]);

  // Drill-down from the Cyber Trends panel: set the filter, then frame the map on the matches.
  const handleCyberFocus = useCallback((focus: CyberFocus | null) => {
    setCyberFocus(focus);
    if (!focus) return;
    const container = globeContainerRef.current?.querySelector(
      '[aria-label="VigilMap interactive globe"]'
    ) as (HTMLElement & { __fitPoints?: (pts: Array<[number, number]>) => void }) | null;
    const pts = windowedEvents
      .filter(ev => activeDomains.has(ev.domain) && isMappable(ev) && matchesCyberFocus(ev, focus))
      .map(ev => [ev.location.lng, ev.location.lat] as [number, number]);
    container?.__fitPoints?.(pts);
  }, [windowedEvents, activeDomains]);

  const anomalySignals = useMemo(
    () => detectAnomalies(filteredEvents),
    [filteredEvents]
  );

  const domainCounts = useMemo(() => countByDomain(windowedEvents), [windowedEvents]);

  // Per-source count of events that are in the current view (time window + selected domains),
  // so the Data Health panel agrees with the chips and the list instead of showing all-time totals.
  const viewCounts = useMemo(() => {
    const inView = new Set(filteredEvents.map(e => e.id));
    const out: Record<string, number> = {};
    for (const [key, ids] of Object.entries(sourceIds)) out[key] = ids.reduce((n, id) => n + (inView.has(id) ? 1 : 0), 0);
    return out;
  }, [filteredEvents, sourceIds]);

  const errorMsg = errors.length > 0 ? `${errors.join(', ')} failed` : null;

  // ── Fly to event ─────────────────────────────────────────
  const flyToEvent = useCallback((ev: VigilEvent) => {
    const container = globeContainerRef.current?.querySelector(
      '[aria-label="VigilMap interactive globe"]'
    ) as (HTMLElement & { __flyTo?: (lat: number, lng: number, zoom: number) => void }) | null;
    if (!isMappable(ev)) return; // e.g. CISA KEV: nothing to fly to
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
          cyberFocus={cyberFocus}
          onCyberFocus={handleCyberFocus}
          windowLabel={timeWindow}
          sourceHealth={sourceHealth}
          viewCounts={viewCounts}
          activeDomains={activeDomains}
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
          timeWindow={timeWindow}
          onTimeWindow={setTimeWindow}
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
                <div style={{ fontSize: '11px', color: '#7d8ba1', marginTop: '6px' }}>
                  USGS · NASA FIRMS · NOAA · GDELT · WHO · ReliefWeb · NASA DONKI · ransomware.live · CISA KEV
                </div>
              </div>
            </div>
          )}

          {/* Active cyber drill-down chip */}
          {cyberFocus && (
            <div style={{
              position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)',
              display: 'flex', alignItems: 'center', gap: '8px', zIndex: 6,
              background: 'rgba(10,15,30,0.92)', border: `1px solid ${DOMAIN_COLORS.cyber}`,
              borderRadius: '16px', padding: '4px 6px 4px 12px',
              fontSize: '12px', color: '#e2e8f0', backdropFilter: 'blur(8px)',
            }}>
              <span>
                {DOMAIN_ICONS.cyber} Ransomware · <strong>{cyberFocus.label}</strong>
                <span style={{ color: '#8a99ae' }}> · {filteredEvents.length} latest claims</span>
              </span>
              <button
                onClick={() => setCyberFocus(null)}
                aria-label="Clear cyber filter"
                style={{
                  background: '#1e293b', border: 'none', color: '#94a3b8', cursor: 'pointer',
                  borderRadius: '10px', width: '20px', height: '20px', fontSize: '11px',
                }}
              >✕</button>
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
              ⚠ {errors.length <= 2 ? `${errors.join(', ')} unavailable` : `${errors.length} sources unavailable`} · see Data Health
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
          cyberFocus={cyberFocus}
          onCyberFocus={handleCyberFocus}
          sourceHealth={sourceHealth}
          viewCounts={viewCounts}
          activeDomains={activeDomains}
        />
      )}
    </div>
  );
}
