/**
 * App.tsx — VigilMap root component
 *
 * Layout:  [Sidebar | DomainFilter + Globe]
 *
 * Data:
 *  - Fetches every source from the shared pipeline (/api/v1/events) in parallel on mount
 *  - De-duplicates events by id across adapters
 *  - Each source refreshes on its own interval (SOURCE_META.refreshSeconds); a failed refresh keeps its last good data
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
import { readViewState, writeViewState, isDefaultView } from './utils/viewState';
import { MobileDrawer } from './components/MobileDrawer';
import { TodayView } from './today/TodayView';
import { OfflineBanner } from './components/OfflineBanner';
import { OFFLINE_BANNER_HEIGHT } from './utils/offline';
import { useOnline } from './hooks/useOnline';
import { fetchSource } from './data/pipeline';
import { applyOutcome } from './data/refresh';
import type { RefreshOutcome } from './data/refresh';
import { SOURCE_META } from '../shared/pipeline/sources';
import { mergeEvents } from '../shared/pipeline/query';
import { collapseIncidents } from '../shared/pipeline/incidents';
import type { CyberFocus, Domain, TimeWindowId, VigilEvent } from './types';
import { DOMAIN_ICONS, DOMAIN_COLORS, DEFAULT_TIME_WINDOW, isExpired, isMappable, matchesCyberFocus, timeWindowMs } from './types';
import { detectAnomalies } from './intelligence/anomaly';
import type { SourceHealth } from './health/sourceHealth';
import type { AnomalySignal } from './intelligence/anomaly';

// ─── Constants ─────────────────────────────────────────────

const ALL_DOMAINS: Domain[] = [
  'disaster', 'climate', 'health', 'conflict', 'economic', 'labor', 'science', 'cyber',
];

const DOMAIN_LABELS: Record<Domain, string> = {
  disaster: 'Disasters',
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

// ─── Helpers ───────────────────────────────────────────────

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
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null);
  const [selectedId, setSelectedId]     = useState<string | undefined>(getEventIdFromURL() ?? undefined);
  // Two destinations: Explore (the globe, the default) and Today (a readable briefing). Today is an overlay,
  // so the globe underneath keeps its state and is not rebuilt when switching back.
  const [view, setView] = useState<'today' | 'explore'>(() => (new URLSearchParams(window.location.search).get('view') === 'today' ? 'today' : 'explore'));
  const changeView = useCallback((next: 'today' | 'explore') => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === 'today') url.searchParams.set('view', 'today'); else url.searchParams.delete('view');
    history.replaceState(null, '', url.toString());
  }, []);
  // The view (time window + hidden domains) survives a refresh: URL > last saved > defaults.
  // Globe position, search text and the cyber drill-down intentionally start fresh.
  const [initialView] = useState(() => readViewState(ALL_DOMAINS));
  const [activeDomains, setActiveDomains] = useState<Set<Domain>>(
    () => new Set(ALL_DOMAINS.filter(d => !initialView.hidden.includes(d))),
  );

  const globeContainerRef = useRef<HTMLDivElement>(null);
  const hasDeepLinked     = useRef(false);
  const loadRunRef        = useRef<Record<string, number>>({});
  const [cyberFocus, setCyberFocus] = useState<CyberFocus | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindowId>(initialView.timeWindow);
  const [sourceHealth, setSourceHealth] = useState<SourceHealth[]>(() =>
    SOURCE_META.map(a => ({
      key: a.key, label: a.label, domain: a.domain, status: 'loading' as const, count: 0, warnings: [], startedAt: Date.now(), optional: a.optional,
      refreshSeconds: a.refreshSeconds, precision: a.precision, coverage: a.coverage,
    })),
  );
  // Each source's last successful result: a refresh starts from it, and a failed source keeps showing it.
  const lastGoodRef = useRef<Map<string, VigilEvent[]>>(new Map());
  const checkedRef = useRef<Map<string, number>>(new Map());
  // Which events each source returned, so Data Health can show how many are in the current view.
  const [sourceIds, setSourceIds] = useState<Record<string, string[]>>({});
  const isMobile = useIsMobile();

  // ── Load sources from the shared pipeline ───────────────
  // Each source loads and refreshes independently: a slow one (GDELT can take 20s) never holds back
  // the fast ones, and each runs on its own interval. Events appear as each source returns.
  const publish = useCallback(() => {
    const merged = mergeEvents(SOURCE_META.map(m => ({ events: lastGoodRef.current.get(m.key) ?? [] })));
    setAllEvents(merged);
    setLastUpdated(new Date());
  }, []);

  const loadSource = useCallback(async (meta: (typeof SOURCE_META)[number]) => {
    const run = (loadRunRef.current[meta.key] = (loadRunRef.current[meta.key] ?? 0) + 1);
    const startedAt = performance.now();
    checkedRef.current.set(meta.key, Date.now());
    let outcome: RefreshOutcome;
    try {
      // Status (ok / degraded / stale / empty / retained) is classified on the server, once, for everyone.
      const fetched = await fetchSource(meta.key);
      if (run !== loadRunRef.current[meta.key]) return; // a newer refresh of this source superseded this one
      lastGoodRef.current.set(meta.key, fetched.events);
      setSourceIds(prev => ({ ...prev, [meta.key]: fetched.events.map(e => e.id) }));
      outcome = { ok: true, fetched };
    } catch (reason) {
      if (run !== loadRunRef.current[meta.key]) return;
      console.error(`[${meta.label}] failed:`, reason);
      // The pipeline could not serve this source at all: keep showing what we already have.
      outcome = { ok: false, error: reason instanceof Error ? reason.message : String(reason), keptCount: lastGoodRef.current.get(meta.key)?.length ?? 0 };
    }
    const timing = { durationMs: Math.round(performance.now() - startedAt), checkedAt: Date.now() };
    setSourceHealth(prev => prev.map(h => (h.key === meta.key ? applyOutcome(h, outcome, timing) : h)));
    publish();
    setLoading(false); // the overlay goes away as soon as any source has answered
  }, [publish]);

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.allSettled(SOURCE_META.map(loadSource));
    setLoading(false);
  }, [loadSource]);

  useEffect(() => {
    load();
    // Per-source timers. Hidden tabs skip refreshes and catch up when they become visible.
    const timers = SOURCE_META.map(meta =>
      setInterval(() => { if (!document.hidden) void loadSource(meta); }, meta.refreshSeconds * 1000),
    );
    const onVisible = () => {
      if (document.hidden) return;
      for (const meta of SOURCE_META) {
        if (Date.now() - (checkedRef.current.get(meta.key) ?? 0) >= meta.refreshSeconds * 1000) void loadSource(meta);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { timers.forEach(clearInterval); document.removeEventListener('visibilitychange', onVisible); };
  }, [load, loadSource]);

  // Offline: say so (with how old the data is), and refresh everything the moment the connection returns.
  const online = useOnline();
  useEffect(() => {
    document.documentElement.toggleAttribute('data-offline', !online); // lets the Today overlay make room for the banner
  }, [online]);
  useEffect(() => {
    const refreshAll = () => { void load(); };
    window.addEventListener('online', refreshAll);
    return () => window.removeEventListener('online', refreshAll);
  }, [load]);

  // Keep the URL and saved view in sync with the controls.
  const hiddenDomains = useMemo(() => ALL_DOMAINS.filter(d => !activeDomains.has(d)), [activeDomains]);
  const viewIsDefault = isDefaultView({ timeWindow, hidden: hiddenDomains });
  useEffect(() => {
    writeViewState({ timeWindow, hidden: hiddenDomains });
  }, [timeWindow, hiddenDomains]);
  const resetView = useCallback(() => {
    setTimeWindow(DEFAULT_TIME_WINDOW);
    setActiveDomains(new Set(ALL_DOMAINS));
  }, []);

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
  //
  // Expired events (a weather alert past its end time) are dropped too, against a clock that ticks
  // every minute: an alert can end between refreshes, and a retained copy can outlive it.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const windowedAll = useMemo(() => {
    const live = allEvents.filter(ev => !isExpired(ev, clock));
    if (!lastUpdated) return live;
    const cutoff = lastUpdated.getTime() - timeWindowMs(timeWindow);
    return live.filter(ev => new Date(ev.timestamp).getTime() >= cutoff);
  }, [allEvents, lastUpdated, timeWindow, clock]);

  // Several reports about one cyber incident (an attacker's claim, a news article, the company's own
  // statement) are shown once, as the strongest report, with the others one tap away. Map, list and
  // counts all use this collapsed set so a dot, a row and a count each mean "one incident".
  const collapsed = useMemo(() => collapseIncidents(windowedAll), [windowedAll]);
  const windowedEvents = collapsed.events;

  const filteredEvents = useMemo(() => {
    const byDomain = windowedEvents.filter(ev => activeDomains.has(ev.domain));
    // Drill-down from the Cyber Trends panel: show only the matching ransomware claims.
    return cyberFocus ? byDomain.filter(ev => matchesCyberFocus(ev, cyberFocus)) : byDomain;
  }, [windowedEvents, activeDomains, cyberFocus]);

  // The Today briefing follows the visitor's view: hidden domains stay hidden there too.
  const briefingEvents = useMemo(() => windowedAll.filter(ev => activeDomains.has(ev.domain)), [windowedAll, activeDomains]);

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
    // A report folded into an incident is in view whenever the incident that represents it is.
    for (const [member, primary] of collapsed.memberToPrimary) if (inView.has(primary)) inView.add(member);
    const out: Record<string, number> = {};
    for (const [key, ids] of Object.entries(sourceIds)) out[key] = ids.reduce((n, id) => n + (inView.has(id) ? 1 : 0), 0);
    return out;
  }, [filteredEvents, sourceIds, collapsed]);

  // Sources that are down (optional extras are shown in Data Health but never raise a banner).
  const errors = useMemo(() => sourceHealth.filter(h => h.status === 'error' && !h.optional).map(h => h.label), [sourceHealth]);
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

  // A link to (or selection of) a report that is now part of an incident highlights the incident's row.
  const listSelectedId = selectedId ? collapsed.memberToPrimary.get(selectedId) ?? selectedId : undefined;

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
      boxSizing: 'border-box',
      paddingTop: online ? 0 : OFFLINE_BANNER_HEIGHT,
      overflow: 'hidden',
      background: '#0a0f1e',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {!online && <OfflineBanner lastUpdated={lastUpdated} />}
      {/* Desktop sidebar — hidden on mobile */}
      {!isMobile && (
        <Sidebar
          onOpenToday={() => changeView('today')}
          events={filteredEvents}
          selectedId={listSelectedId}
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
          viewIsDefault={viewIsDefault}
          viewSummary={`${timeWindow === DEFAULT_TIME_WINDOW ? '' : `window ${timeWindow}`}${timeWindow !== DEFAULT_TIME_WINDOW && hiddenDomains.length ? ' · ' : ''}${hiddenDomains.length ? `${hiddenDomains.length} domain${hiddenDomains.length === 1 ? '' : 's'} hidden` : ''}`}
          onResetView={resetView}
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
                title="Clear this filter and show all cyber events"
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
          onOpenToday={() => changeView('today')}
          events={filteredEvents}
          selectedId={listSelectedId}
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

      {view === 'today' && (
        <TodayView
          events={briefingEvents}
          hiddenDomains={hiddenDomains}
          filteredView={!viewIsDefault}
          lastUpdated={lastUpdated}
          loading={loading}
          onExplore={() => changeView('explore')}
          onShowOnMap={ev => { changeView('explore'); handleSelectEvent(ev); }}
        />
      )}
    </div>
  );
}
