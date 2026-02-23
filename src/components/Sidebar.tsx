/**
 * Sidebar.tsx
 *
 * Lists the 10 most recent VigilEvents with colour-coded severity badges.
 * Clicking a row calls onSelectEvent so the globe can fly to it.
 */

import type { VigilEvent } from '../types';
import { earthquakeColor, DOMAIN_ICONS } from '../types';
import { IntelBrief } from './IntelBrief';

interface SidebarProps {
  events: VigilEvent[];
  selectedId?: string;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  onSelectEvent: (event: VigilEvent) => void;
  onRefresh: () => void;
}

function MagnitudeBadge({ mag }: { mag: number }) {
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
      }}
    >
      M{mag.toFixed(1)}
    </span>
  );
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

export function Sidebar({
  events,
  selectedId,
  loading,
  error,
  lastUpdated,
  onSelectEvent,
  onRefresh,
}: SidebarProps) {
  const recent = events.slice(0, 10);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
            <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>
              Global Intelligence Platform
            </p>
          </div>
        </div>
      </div>

      {/* ── AI Intel Brief ───────────────────────────────────── */}
      <IntelBrief events={events} />

      {/* ── Filter / legend bar ─────────────────────────────── */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontSize: '11px',
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginRight: 4,
          }}
        >
          Magnitude
        </span>
        {[
          { label: 'M5+', color: '#ef4444' },
          { label: 'M3–5', color: '#f97316' },
          { label: '<M3', color: '#facc15' },
        ].map(item => (
          <span
            key={item.label}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: '#94a3b8',
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: item.color,
                display: 'inline-block',
              }}
            />
            {item.label}
          </span>
        ))}
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
          color: '#64748b',
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

      {/* ── Section header ──────────────────────────────────── */}
      <div
        style={{
          padding: '10px 16px 6px',
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: '#475569',
        }}
      >
        {DOMAIN_ICONS.disaster} Recent Earthquakes (24h)
      </div>

      {/* ── Event list ─────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && recent.length === 0 && (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: '#475569',
              fontSize: '13px',
            }}
          >
            Loading earthquake data…
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

        {recent.map(ev => {
          const mag = (ev.metadata?.magnitude as number) ?? 0;
          const isSelected = ev.id === selectedId;

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
              {/* Magnitude badge */}
              <div style={{ paddingTop: '2px', flexShrink: 0 }}>
                <MagnitudeBadge mag={mag} />
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
                  {ev.location.label}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: '#64748b',
                    marginTop: '2px',
                    display: 'flex',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>{timeAgo(ev.timestamp)}</span>
                  {ev.metadata?.depth_km !== undefined && (
                    <span>Depth: {Number(ev.metadata.depth_km).toFixed(0)} km</span>
                  )}
                  {Boolean(ev.metadata?.tsunami) && (
                    <span style={{ color: '#3b82f6' }}>🌊 Tsunami alert</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Footer ──────────────────────────────────────────── */}
      <div
        style={{
          padding: '10px 16px',
          borderTop: '1px solid #1e293b',
          fontSize: '10px',
          color: '#334155',
          textAlign: 'center',
        }}
      >
        Data: USGS Earthquake Hazards Program · MIT License
      </div>
    </aside>
  );
}
