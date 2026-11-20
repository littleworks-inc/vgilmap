/**
 * Sidebar.tsx
 *
 * Lists the 10 most recent VigilEvents with colour-coded severity badges.
 * Clicking a row calls onSelectEvent so the globe can fly to it.
 */

import { useState, useRef, useEffect } from 'react';
import type { VigilEvent } from '../types';
import { earthquakeColor, DOMAIN_COLORS, DOMAIN_ICONS, isMappable, NO_MAP_LOCATION } from '../types';
import { IntelBrief } from './IntelBrief';
import { AnomalyPanel } from './AnomalyPanel';
import { CyberTrendsPanel } from './CyberTrendsPanel';
import { DataHealthPanel } from './DataHealthPanel';
import type { SourceHealth } from '../health/sourceHealth';
import type { Domain } from '../types';
import type { AnomalySignal } from '../intelligence/anomaly';
import type { CyberFocus } from '../types';

interface SidebarProps {
  events: VigilEvent[];
  selectedId?: string;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  onSelectEvent: (event: VigilEvent) => void;
  onRefresh: () => void;
  anomalySignals: AnomalySignal[];
  onSelectSignal: (signal: AnomalySignal) => void;
  cyberFocus: CyberFocus | null;
  onCyberFocus: (focus: CyberFocus | null) => void;
  windowLabel: string;
  sourceHealth: SourceHealth[];
  viewCounts: Record<string, number>;
  activeDomains: Set<Domain>;
}

/** Earthquake: coloured M-badge. Other domains: coloured dot with domain icon. */
function EventBadge({ event }: { event: VigilEvent }) {
  if (event.category === 'earthquake') {
    const mag = (event.metadata?.magnitude as number) ?? 0;
    const color = earthquakeColor(mag);
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '1px 6px',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 700,
          color: '#fff',
          backgroundColor: color,
          minWidth: '36px',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        M{mag.toFixed(1)}
      </span>
    );
  }

  const domainColor = DOMAIN_COLORS[event.domain] ?? '#6b7280';
  const domainIcon  = DOMAIN_ICONS[event.domain]  ?? '🌐';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '32px',
        height: '20px',
        borderRadius: '4px',
        fontSize: '13px',
        background: `${domainColor}22`,
        border: `1px solid ${domainColor}55`,
        flexShrink: 0,
      }}
      title={event.domain}
    >
      {domainIcon}
    </span>
  );
}

/** Subtitle metadata line — varies by category */
function EventMeta({ event }: { event: VigilEvent }) {
  const meta = event.metadata ?? {};

  if (event.category === 'earthquake') {
    return (
      <>
        {meta.depth_km !== undefined && (
          <span>Depth: {Number(meta.depth_km).toFixed(0)} km</span>
        )}
        {Boolean(meta.tsunami) && (
          <span style={{ color: '#3b82f6' }}>🌊 Tsunami alert</span>
        )}
      </>
    );
  }
  if (event.category === 'wildfire') {
    const frp = meta.frp != null ? `FRP: ${Number(meta.frp).toFixed(0)} MW` : null;
    return frp ? <span style={{ color: '#f97316' }}>{frp}</span> : null;
  }
  if (event.category === 'extreme-weather') {
    const type = meta.event_type as string | undefined;
    return type ? <span style={{ color: '#60a5fa' }}>{type}</span> : null;
  }
  if (event.category === 'ransomware') {
    const victim = meta.victim as string | undefined;
    const sector = meta.sector as string | undefined;
    const group = meta.group as string | undefined;
    return (
      <span style={{ color: '#84cc16' }}>
        {[victim, sector, group && `by ${group}`].filter(Boolean).join(' · ')}
      </span>
    );
  }
  if (event.domain === 'cyber' && event.category !== 'ransomware' && event.category !== 'vulnerability') {
    // data breaches and cyber-incident news: say who was impacted, and how big
    const impacted = meta.impacted as string | undefined;
    const accounts = meta.pwnCount != null ? `${Number(meta.pwnCount).toLocaleString()} accounts` : null;
    const kind = (meta.kind as string | undefined) ?? event.category.replace('-', ' ');
    return (
      <span style={{ color: '#84cc16' }}>
        {[kind, impacted && `impacted${meta.pwnCount == null ? ' (per headline)' : ''}: ${impacted}`, accounts].filter(Boolean).join(' · ')}
      </span>
    );
  }
  if (event.category === 'vulnerability') {
    const vendor = meta.vendor as string | undefined;
    const product = meta.product as string | undefined;
    return (
      <span style={{ color: '#84cc16' }}>
        {[vendor, product].filter(Boolean).join(' ')}
        {Boolean(meta.ransomwareUse) && ' · ransomware-linked'}
      </span>
    );
  }
  if (event.domain === 'science') {
    const tags = (event.tags ?? []).slice(0, 2).join(' · ');
    return tags ? (
      <span style={{ color: '#10b981' }}>{tags}</span>
    ) : null;
  }
  return null;
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Share button ───────────────────────────────────────────

function ShareButton({ eventId }: { eventId: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation(); // don't trigger row click
    const url = new URL(window.location.href);
    url.searchParams.set('event', eventId);
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {/* silent fail */});
  };

  return (
    <button
      onClick={handleCopy}
      title="Copy link to this event"
      style={{
        background: 'none',
        border: 'none',
        padding: '0 2px',
        cursor: 'pointer',
        color: copied ? '#22c55e' : '#334155',
        fontSize: '12px',
        lineHeight: 1,
        transition: 'color 0.2s',
        flexShrink: 0,
      }}
    >
      {copied ? '✓' : '⎘'}
    </button>
  );
}

type ListFilter = 'all' | 'map' | 'nomap';
type ListRow = { kind: 'event'; ev: VigilEvent } | { kind: 'kev'; events: VigilEvent[] };

/** An entry from CISA's KEV catalogue (not a news story about an exploited bug). */
const isKevEntry = (ev: VigilEvent) => ev.category === 'vulnerability' && ev.source === 'CISA KEV';

export function Sidebar({
  events,
  selectedId,
  loading,
  error,
  lastUpdated,
  onSelectEvent,
  onRefresh,
  anomalySignals,
  onSelectSignal,
  cyberFocus,
  onCyberFocus,
  windowLabel,
  sourceHealth,
  viewCounts,
  activeDomains,
}: SidebarProps) {
  const [showAll, setShowAll]   = useState(false);
  const [query, setQuery]       = useState('');
  // List-only controls: transient (they start fresh on refresh, like search and Show all).
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [kevOpen, setKevOpen]       = useState(false);
  const INITIAL_COUNT = 50;
  // Normalize search query
  const trimmed = query.trim().toLowerCase();
  // Filter events by keyword when searching
  const matchedEvents = trimmed
    ? events.filter(ev => {
        const haystack = [
          ev.title,
          ev.location.label,
          ev.location.country,
          ev.location.region,
          ev.category,
          ev.source,
          ...(ev.tags ?? []),
        ].join(' ').toLowerCase();
        return haystack.includes(trimmed);
      })
    : events;
  // When searching show all matches; otherwise respect showAll/INITIAL_COUNT
  // "On map" / "No location" filter, with counts that follow the search box.
  const base = trimmed ? matchedEvents : events;
  const onMapCount = base.filter(isMappable).length;
  const listCounts = { all: base.length, map: onMapCount, nomap: base.length - onMapCount };
  const filtered = listFilter === 'map' ? base.filter(isMappable)
    : listFilter === 'nomap' ? base.filter(ev => !isMappable(ev))
    : base;

  // Group the CISA KEV catalogue entries into one collapsible row: there can be dozens, they can
  // never be plotted, and as separate rows they flood the list. A lone entry stays a normal row.
  const rows: ListRow[] = [];
  let kevGroup: Extract<ListRow, { kind: 'kev' }> | null = null;
  for (const ev of trimmed ? filtered.slice(0, 200) : filtered) {
    if (isKevEntry(ev)) {
      if (!kevGroup) { kevGroup = { kind: 'kev', events: [] }; rows.push(kevGroup); }
      kevGroup.events.push(ev);
    } else {
      rows.push({ kind: 'event', ev });
    }
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind === 'kev' && r.events.length === 1) rows[i] = { kind: 'event', ev: r.events[0] };
  }
  const recent = trimmed ? rows : (showAll ? rows : rows.slice(0, INITIAL_COUNT));
  // Reset showAll when query changes
  const prevQuery = useRef('');
  useEffect(() => {
    if (prevQuery.current !== trimmed) {
      setShowAll(false);
      prevQuery.current = trimmed;
    }
  }, [trimmed]);

  // One event row. Used directly and inside the expanded KEV group.
  const renderEventRow = (ev: VigilEvent) => {
          const isSelected = ev.id === selectedId;
          // For earthquakes show the location label; for all others show the title
          const primaryText = ev.category === 'earthquake' ? ev.location.label : ev.title;

          return (
            <button
              key={ev.id}
              onClick={() => onSelectEvent(ev)}
              style={{
                width: '100%',
                textAlign: 'left',
                background: isSelected ? '#1e3a5f' : 'transparent',
                border: 'none',
                borderBottom: '1px solid #1e293b',
                padding: '10px 16px',
                cursor: 'pointer',
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e =>
                !isSelected && ((e.currentTarget as HTMLElement).style.background = '#172033')
              }
              onMouseLeave={e =>
                !isSelected && ((e.currentTarget as HTMLElement).style.background = 'transparent')
              }
            >
              {/* Domain-aware badge */}
              <div style={{ paddingTop: '2px', flexShrink: 0 }}>
                <EventBadge event={ev} />
              </div>

              {/* Text */}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 500,
                    color: '#e2e8f0',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {primaryText}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: '#8a99ae',
                    marginTop: '2px',
                    display: 'flex',
                    gap: '8px',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <span>{timeAgo(ev.timestamp)}</span>
                  <EventMeta event={ev} />
                  {/* One consistent marker for every event that is listed but not plotted */}
                  {!isMappable(ev) && (
                    <span
                      title="This event has no real-world place, so it appears in the list but not on the map"
                      style={{ fontSize: '10px', padding: '0 6px', borderRadius: '8px', border: '1px solid #334155', color: '#8a99ae', whiteSpace: 'nowrap' }}
                    >
                      {NO_MAP_LOCATION}
                    </span>
                  )}
                  <ShareButton eventId={ev.id} />
                </div>
              </div>
            </button>
          );
  };

  // The collapsed-by-default group for CISA KEV entries.
  const renderKevGroup = (list: VigilEvent[]) => {
    const open = kevOpen || list.some(e => e.id === selectedId); // a selected entry must be visible
    return (
      <div key="kev-group">
        <button
          onClick={() => setKevOpen(o => !o)}
          aria-expanded={open}
          title="CISA's Known Exploited Vulnerabilities catalogue. These are software flaws, so they have no map location."
          style={{
            width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', gap: '10px', alignItems: 'center',
            padding: '10px 16px', background: '#0f172a', border: 'none', borderLeft: '3px solid #84cc16',
            borderBottom: '1px solid #1e293b',
          }}
        >
          <span style={{ fontSize: '16px', flexShrink: 0 }}>{DOMAIN_ICONS.cyber}</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
              Exploited vulnerabilities · {list.length}
            </span>
            <span style={{ display: 'block', fontSize: '11px', color: '#8a99ae', marginTop: '2px' }}>
              CISA KEV · newest {timeAgo(list[0].timestamp)} · {NO_MAP_LOCATION}
            </span>
          </span>
          <span aria-hidden style={{ fontSize: '11px', color: '#7d8ba1' }}>{open ? '▲' : '▼'}</span>
        </button>
        {open && list.map(renderEventRow)}
      </div>
    );
  };

  return (
    <aside
      style={{
        width: '320px',
        flexShrink: 0,
        background: '#0f172a',
        borderRight: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* ── Header ──────────────────────────────────────────── */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid #1e293b',
          background: '#0a0f1e',
        }}
      >
        <a
          href="/"
          style={{
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: '22px' }}>🌍</span>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: '17px',
                fontWeight: 700,
                color: '#f1f5f9',
                letterSpacing: '0.02em',
              }}
            >
              VigilMap
            </h1>
            <p style={{ margin: 0, fontSize: '11px', color: '#8a99ae' }}>
              Global Intelligence Platform
            </p>
          </div>
        </a>
      </div>

      {/*
        The panels above the list live in their own height-capped scroll region. Without the cap,
        opening a tall panel (Data Health has 11 rows) used up the whole sidebar and left the event
        list zero pixels high, so "Show all N events" appeared to do nothing.
      */}
      <div style={{ flexShrink: 0, maxHeight: '28vh', overflowY: 'auto', overscrollBehavior: 'contain' }}>
      {/* ── AI Intel Brief ───────────────────────────────────── */}
      <IntelBrief events={events} anomalySignals={anomalySignals} />

      {/* ── Anomaly Signals ──────────────────────────────────── */}
      <AnomalyPanel signals={anomalySignals} onSelectSignal={onSelectSignal} />

      {/* ── Cyber Trends (hidden until Redis history exists) ─── */}
      <CyberTrendsPanel focus={cyberFocus} onFocus={onCyberFocus} />

      {/* ── Data Health: which sources are live / stale / down ── */}
      <DataHealthPanel sources={sourceHealth} viewCounts={viewCounts} activeDomains={activeDomains} />
      </div>


      {/* ── Status bar ──────────────────────────────────────── */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '12px',
          color: '#8a99ae',
        }}
      >
        <span>
          {loading ? (
            <span style={{ color: '#f97316' }}>⟳ Fetching…</span>
          ) : error ? (
            <span style={{ color: '#ef4444' }}>⚠ {error}</span>
          ) : (
            <>
              <span style={{ color: '#22c55e' }}>●</span>
              {' '}
              {events.length} events
              {lastUpdated && (
                <span> · updated {timeAgo(lastUpdated.toISOString())}</span>
              )}
            </>
          )}
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            background: 'none',
            border: '1px solid #334155',
            borderRadius: '4px',
            color: loading ? '#334155' : '#94a3b8',
            cursor: loading ? 'default' : 'pointer',
            fontSize: '11px',
            padding: '2px 8px',
          }}
        >
          Refresh
        </button>
      </div>

      {/* ── Section header + search ─────────────────────────── */}
      <div style={{ borderBottom: '1px solid #1e293b' }}>
        {/* Header row */}
        <div style={{
          padding: '10px 16px 6px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.1em',
            color: '#7d8ba1',
          }}>
            {trimmed
              ? `${matchedEvents.length} result${matchedEvents.length !== 1 ? 's' : ''}`
              : `Recent Events (${windowLabel})`}
          </span>
          {trimmed && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'none', border: 'none',
                color: '#7d8ba1', cursor: 'pointer',
                fontSize: '11px', padding: '0',
              }}
            >
              Clear ×
            </button>
          )}
        </div>
        {/* Search input */}
        <div style={{ padding: '0 12px 8px', position: 'relative' }}>
          <span style={{
            position: 'absolute',
            left: '22px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '13px',
            color: '#334155',
            pointerEvents: 'none',
            lineHeight: 1,
          }}>🔍</span>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search events, locations…"
            style={{
              width: '100%',
              boxSizing: 'border-box' as const,
              background: '#0a0f1e',
              border: '1px solid #1e293b',
              borderRadius: '6px',
              color: '#e2e8f0',
              fontSize: '12px',
              padding: '6px 28px 6px 30px',
              outline: 'none',
              fontFamily: 'inherit',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.target.style.borderColor = '#3b82f6')}
            onBlur={e => (e.target.style.borderColor = '#1e293b')}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{
                position: 'absolute',
                right: '20px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: '#7d8ba1',
                cursor: 'pointer',
                fontSize: '14px',
                lineHeight: 1,
                padding: '0',
              }}
            >
              ×
            </button>
          )}
        </div>
        {/* Filter by whether an event can be shown on the map */}
        <div role="group" aria-label="Filter the list by map location" style={{ display: 'flex', gap: '4px', padding: '0 12px 8px' }}>
          {([
            ['all', 'All', listCounts.all],
            ['map', 'On map', listCounts.map],
            ['nomap', 'No location', listCounts.nomap],
          ] as Array<[ListFilter, string, number]>).map(([id, label, n]) => {
            const on = listFilter === id;
            return (
              <button
                key={id}
                onClick={() => { setListFilter(id); setShowAll(false); }}
                aria-pressed={on}
                style={{
                  flex: 1, fontSize: '11px', fontWeight: 600, padding: '4px 0', cursor: 'pointer', borderRadius: '6px',
                  border: `1px solid ${on ? '#3b82f6' : '#334155'}`,
                  background: on ? '#1e3a5f' : 'transparent',
                  color: on ? '#e2e8f0' : '#8a99ae', whiteSpace: 'nowrap',
                }}
              >
                {label} <span style={{ fontWeight: 500, opacity: 0.85 }}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Event list ─────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: '140px', overflowY: 'auto' }}>
        {loading && recent.length === 0 && (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: '#7d8ba1',
              fontSize: '13px',
            }}
          >
            Loading events…
          </div>
        )}

        {!loading && trimmed && matchedEvents.length === 0 && (
          <div style={{
            padding: '24px 16px',
            textAlign: 'center',
            color: '#7d8ba1',
            fontSize: '13px',
          }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔍</div>
            No events match <strong style={{ color: '#94a3b8' }}>"{query}"</strong>
            <br />
            <button
              onClick={() => setQuery('')}
              style={{
                marginTop: '10px',
                padding: '4px 12px',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '4px',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Clear search
            </button>
          </div>
        )}

        {!loading && error && recent.length === 0 && (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: '#ef4444',
              fontSize: '13px',
            }}
          >
            Failed to load data.
            <br />
            <button
              onClick={onRefresh}
              style={{
                marginTop: '8px',
                padding: '4px 12px',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '4px',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Try again
            </button>
          </div>
        )}

        {recent.map(row => row.kind === 'kev'
          ? renderKevGroup(row.events)
          : renderEventRow(row.ev))}
        {!loading && !error && base.length > 0 && filtered.length === 0 && (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: '#7d8ba1', fontSize: '12px' }}>
            {listFilter === 'map' ? 'Every event in this view has no map location.' : 'Every event in this view is on the map.'}
          </div>
        )}
      </div>

      {/* ── Load more / footer ──────────────────────────── */}
      {!trimmed && rows.length > INITIAL_COUNT && (
        <button
          onClick={() => setShowAll(v => !v)}
          style={{
            width: '100%',
            padding: '10px',
            background: 'none',
            border: 'none',
            borderTop: '1px solid #1e293b',
            color: '#7d8ba1',
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
        >
          {showAll
            ? `▲ Show less`
            : `▼ Show all ${filtered.length} events`}
        </button>
      )}
      <div
        style={{
          padding: '10px 16px',
          borderTop: '1px solid #1e293b',
          fontSize: '10px',
          color: '#334155',
          textAlign: 'center',
        }}
      >
        USGS · NASA FIRMS · NOAA · GDELT · WHO · NASA DONKI · ransomware.live · CISA KEV · MIT License
      </div>
    </aside>
  );
}
