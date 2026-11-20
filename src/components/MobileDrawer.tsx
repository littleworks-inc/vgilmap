/**
 * MobileDrawer — bottom sheet that slides up over the map on mobile.
 * Peek height 90px shows the status bar + drag handle.
 * Full height shows the full sidebar content.
 */
import { useState, useRef } from 'react';
import type { VigilEvent } from '../types';
import { DOMAIN_COLORS, DOMAIN_ICONS, isMappable, NO_MAP_LOCATION } from '../types';
import { IntelBrief } from './IntelBrief';
import { AnomalyPanel } from './AnomalyPanel';
import { CyberTrendsPanel } from './CyberTrendsPanel';
import { DataHealthPanel } from './DataHealthPanel';
import { SourceLink } from './SourceLink';
import { ListFilterBar } from './ListFilterBar';
import { KevGroupHeader } from './KevGroupHeader';
import { buildListRows } from '../utils/listRows';
import type { ListFilter } from '../utils/listRows';
import type { SourceHealth } from '../health/sourceHealth';
import type { Domain } from '../types';
import type { AnomalySignal } from '../intelligence/anomaly';
import type { CyberFocus } from '../types';
interface MobileDrawerProps {
  events: VigilEvent[];
  selectedId?: string;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  onSelectEvent: (ev: VigilEvent) => void;
  onRefresh: () => void;
  anomalySignals: AnomalySignal[];
  onSelectSignal: (signal: AnomalySignal) => void;
  cyberFocus: CyberFocus | null;
  onCyberFocus: (focus: CyberFocus | null) => void;
  sourceHealth: SourceHealth[];
  viewCounts: Record<string, number>;
  activeDomains: Set<Domain>;
}
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
const PEEK_H = 110;  // px visible when collapsed
export function MobileDrawer({
  events, selectedId, loading, error, lastUpdated,
  onSelectEvent, onRefresh, anomalySignals, onSelectSignal, cyberFocus, onCyberFocus, sourceHealth, viewCounts, activeDomains,
}: MobileDrawerProps) {
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null); // which no-location row is opened
  // Same list controls as the desktop sidebar (transient: they reset on refresh).
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [kevOpen, setKevOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const startY = useRef<number | null>(null);
  // Touch drag to open/close
  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const delta = startY.current - e.changedTouches[0].clientY;
    if (delta > 40) setExpanded(true);
    if (delta < -40) setExpanded(false);
    startY.current = null;
  };
  // Filter + KEV grouping come from the shared helper; the drawer shows the newest rows and offers
  // "Show all" so a long filtered list isn't silently cut off.
  const DRAWER_ROWS = 20;
  const { counts: listCounts, filtered, rows } = buildListRows(events, listFilter);
  const recent = showAll ? rows : rows.slice(0, DRAWER_ROWS);
  const critCount = anomalySignals.filter(s => s.severity === 'critical').length;
  // One event row (used directly and inside the expanded KEV group).
  const renderEventRow = (ev: VigilEvent) => {
            const isSelected = ev.id === selectedId;
            const color = DOMAIN_COLORS[ev.domain] ?? '#6b7280';
            const icon = DOMAIN_ICONS[ev.domain] ?? '🌐';
            const unmapped = !isMappable(ev);
            const opened = unmapped && openId === ev.id;
            return (
              <div
                key={ev.id}
                role="button"
                tabIndex={0}
                aria-expanded={unmapped ? opened : undefined}
                onClick={() => {
                  onSelectEvent(ev);
                  if (unmapped) {
                    // Nothing to fly to, so collapsing the drawer would reveal an empty spot on the
                    // map. Open the event's details here instead.
                    setOpenId(opened ? null : ev.id);
                  } else {
                    setExpanded(false); // collapse so the map flies into view
                  }
                }}
                onKeyDown={e => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (e.currentTarget as HTMLElement).click(); }
                }}
                style={{
                  width: '100%', textAlign: 'left',
                  background: isSelected ? '#1e3a5f' : 'transparent',
                  border: 'none', borderBottom: '1px solid #1e293b',
                  padding: '12px 16px', cursor: 'pointer',
                  display: 'flex', gap: '12px', alignItems: 'flex-start',
                }}
              >
                <span style={{
                  fontSize: '18px', flexShrink: 0, paddingTop: '1px',
                  filter: `drop-shadow(0 0 4px ${color})`,
                }}>{icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px', fontWeight: 500, color: '#e2e8f0',
                    whiteSpace: opened ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {ev.category === 'earthquake' ? ev.location.label : ev.title}
                  </div>
                  <div style={{ fontSize: '11px', color: '#8a99ae', marginTop: '2px', display: 'flex', flexWrap: 'wrap', gap: '4px 8px', alignItems: 'center' }}>
                    <span>
                      {timeAgo(ev.timestamp)}
                      {isMappable(ev) ? (ev.location.label && ` · ${ev.location.label}`) : ` · ${NO_MAP_LOCATION}`}
                    </span>
                    <SourceLink event={ev} />
                    {unmapped && <span aria-hidden style={{ color: '#7d8ba1' }}>{opened ? 'details ▴' : 'details ▾'}</span>}
                  </div>

                  {/* What the event is about, for events that have no map popup to show it */}
                  {opened && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#cbd5e1', lineHeight: 1.45, whiteSpace: 'normal', cursor: 'default' }}
                         onClick={e => e.stopPropagation()}>
                      <div>{ev.description}</div>
                      <div style={{ marginTop: '6px', fontSize: '11px', color: '#8a99ae' }}>
                        {ev.source} · {new Date(ev.timestamp).toLocaleString()}
                      </div>
                      <div style={{ marginTop: '8px', fontSize: '13px' }}>
                        <SourceLink event={ev} label={`Read the report on ${ev.source} ↗`} />
                      </div>
                    </div>
                  )}
                </div>
                <span style={{
                  flexShrink: 0, fontSize: '10px', fontWeight: 700,
                  padding: '2px 6px', borderRadius: '4px', marginLeft: 'auto',
                  background: `${color}22`, border: `1px solid ${color}55`,
                  color, alignSelf: 'center',
                }}>
                  {ev.severity}
                </span>
              </div>
            );
  };

  const renderKevGroup = (list: VigilEvent[]) => {
    const open = kevOpen || list.some(e => e.id === selectedId); // a selected entry must be visible
    return (
      <div key="kev-group">
        <KevGroupHeader
          count={list.length}
          newestAgo={timeAgo(list[0].timestamp)}
          open={open}
          onToggle={() => setKevOpen(o => !o)}
          padding="12px 16px"
        />
        {open && list.map(renderEventRow)}
      </div>
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        height: expanded ? '82vh' : `${PEEK_H}px`,
        transition: 'height 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
        background: '#0f172a',
        borderTop: '1px solid #1e293b',
        borderRadius: '16px 16px 0 0',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 -4px 32px rgba(0,0,0,0.5)',
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Drag handle + summary row */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          padding: '10px 16px 8px',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {/* Handle pill */}
        <div style={{
          width: '36px', height: '4px', borderRadius: '2px',
          background: '#334155', margin: '0 auto 10px',
        }} />
        {/* Summary row */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🌍</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#f1f5f9' }}>
                VigilMap
              </div>
              <div style={{ fontSize: '11px', color: '#8a99ae' }}>
                {loading ? 'Loading…' : `${events.length} events`}
                {lastUpdated && !loading && (
                  <span> · {timeAgo(lastUpdated.toISOString())}</span>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Critical badge */}
            {critCount > 0 && (
              <span style={{
                background: '#7c3aed22', border: '1px solid #7c3aed',
                color: '#a78bfa', borderRadius: '10px',
                padding: '2px 8px', fontSize: '11px', fontWeight: 700,
              }}>
                ⚡ {critCount} critical
              </span>
            )}
            {/* Live dot */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: '#22c55e', boxShadow: '0 0 5px #22c55e',
              }} />
              <span style={{
                fontSize: '9px', fontWeight: 700,
                letterSpacing: '1px', color: '#22c55e',
              }}>LIVE</span>
            </div>
            {/* Chevron */}
            <span style={{
              fontSize: '12px', color: '#7d8ba1',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.3s',
              display: 'inline-block',
            }}>▼</span>
          </div>
        </div>
      </div>
      {/* Scrollable content — only shown when expanded */}
      {expanded && (
        <div style={{ flex: 1, overflowY: 'auto', borderTop: '1px solid #1e293b' }}>
          {/* Intel Brief */}
          <IntelBrief events={events} anomalySignals={anomalySignals} />
          {/* Anomaly Panel */}
          <AnomalyPanel signals={anomalySignals} onSelectSignal={(sig) => {
            onSelectSignal(sig);
            setExpanded(false); // collapse drawer so map is visible
          }} />
          {/* Cyber Trends */}
          <CyberTrendsPanel
            focus={cyberFocus}
            onFocus={(f) => {
              onCyberFocus(f);
              if (f) setExpanded(false); // collapse the drawer so the filtered map is visible
            }}
          />
          {/* Data Health */}
          <DataHealthPanel sources={sourceHealth} viewCounts={viewCounts} activeDomains={activeDomains} />
          {/* Refresh row */}
          <div style={{
            padding: '8px 16px',
            borderBottom: '1px solid #1e293b',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: '11px', fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7d8ba1' }}>
              Recent Events
            </span>
            <button
              onClick={onRefresh}
              disabled={loading}
              style={{
                background: 'none', border: '1px solid #334155',
                borderRadius: '4px', color: '#94a3b8',
                cursor: 'pointer', fontSize: '11px', padding: '2px 8px',
              }}
            >
              Refresh
            </button>
          </div>
          <ListFilterBar counts={listCounts} value={listFilter} onChange={f => { setListFilter(f); setShowAll(false); }} compact />
          {/* Event list */}
          {recent.map(row => row.kind === 'kev' ? renderKevGroup(row.events) : renderEventRow(row.ev))}
          {filtered.length === 0 && events.length > 0 && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: '#7d8ba1', fontSize: '12px' }}>
              {listFilter === 'map' ? 'Every event in this view has no map location.' : 'Every event in this view is on the map.'}
            </div>
          )}
          {rows.length > DRAWER_ROWS && (
            <button
              onClick={() => setShowAll(v => !v)}
              style={{ width: '100%', padding: '14px', background: 'none', border: 'none', borderTop: '1px solid #1e293b', color: '#7d8ba1', fontSize: '12px', cursor: 'pointer' }}
            >
              {showAll ? '▲ Show less' : `▼ Show all ${filtered.length} events`}
            </button>
          )}
          {error && (
            <div style={{ padding: '12px 16px', color: '#ef4444', fontSize: '12px' }}>
              ⚠ {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
