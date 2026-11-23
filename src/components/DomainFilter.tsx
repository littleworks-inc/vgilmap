/**
 * DomainFilter.tsx
 *
 * A pill-button row that sits at the top of the map area.
 * Each pill represents one VigilEvent domain. Clicking toggles it.
 * Active domains are highlighted with their domain colour.
 */

import type { Domain } from '../types';
import { DOMAIN_COLORS, DOMAIN_ICONS, TIME_WINDOWS } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';
import type { TimeWindowId } from '../types';

// ─── Domain display config ─────────────────────────────────

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

// Only show domains that actually have data (or will soon)
const VISIBLE_DOMAINS: Domain[] = [
  'disaster',
  'climate',
  'health',
  'conflict',
  'economic',
  'labor',
  'science',
  'cyber',
];

// ─── Component ─────────────────────────────────────────────

interface DomainFilterProps {
  activeDomains: Set<Domain>;
  counts: Partial<Record<Domain, number>>;
  onToggle: (domain: Domain) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  timeWindow: TimeWindowId;
  onTimeWindow: (id: TimeWindowId) => void;
  /** True when the time window and domain chips are at their defaults. */
  viewIsDefault: boolean;
  /** Short description of what differs from the default, for the tooltip. */
  viewSummary: string;
  onResetView: () => void;
}

export function DomainFilter({
  activeDomains,
  counts,
  onToggle,
  onSelectAll,
  onClearAll,
  timeWindow,
  onTimeWindow,
  viewIsDefault,
  viewSummary,
  onResetView,
}: DomainFilterProps) {
  // With 9 domains the chips don't fit in one row on a laptop: wrap them there (so none is hidden),
  // and keep the single scrollable row on phones where vertical space is scarce.
  const isMobile = useIsMobile();
  const domainsWithData = VISIBLE_DOMAINS.filter(d => (counts[d] ?? 0) > 0);
  const allActive = domainsWithData.every(d => activeDomains.has(d));
  const noneActive = domainsWithData.every(d => !activeDomains.has(d));

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: isMobile ? 'nowrap' : 'wrap',
        rowGap: '6px',
        overflowX: isMobile ? ('auto' as const) : ('visible' as const),
        WebkitOverflowScrolling: 'touch' as const,
        padding: '8px 12px',
        background: 'rgba(10,15,30,0.88)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #1e293b',
        zIndex: 10,
        position: 'relative',
        scrollbarWidth: 'none',
      }}
    >
      {/* All / None shortcuts */}
      <button
        onClick={allActive ? onClearAll : onSelectAll}
        title={allActive ? 'Hide all layers' : 'Show all layers'}
        style={{
          ...pillBase,
          background: allActive ? '#334155' : '#1e293b',
          color: allActive ? '#e2e8f0' : '#64748b',
          border: `1px solid ${allActive ? '#475569' : '#334155'}`,
          fontSize: '11px',
          padding: '3px 10px',
        }}
      >
        {allActive ? 'All ✓' : 'All'}
      </button>

      <div style={{ width: '1px', height: '20px', background: '#1e293b', margin: '0 2px' }} />

      {/* One pill per domain */}
      {VISIBLE_DOMAINS.filter(domain => (counts[domain] ?? 0) > 0).map(domain => {
        const active = activeDomains.has(domain);
        const count = counts[domain] ?? 0;
        const color = DOMAIN_COLORS[domain];

        return (
          <button
            key={domain}
            onClick={() => onToggle(domain)}
            title={`Toggle ${DOMAIN_LABELS[domain]}`}
            style={{
              ...pillBase,
              background: active ? `${color}22` : '#1e293b',
              color: active ? color : '#475569',
              border: `1px solid ${active ? color : '#1e293b'}`,
              opacity: count === 0 ? 0.45 : 1,
            }}
          >
            <span style={{ fontSize: '13px', lineHeight: 1 }}>
              {DOMAIN_ICONS[domain]}
            </span>
            <span style={{ fontWeight: 600 }}>{DOMAIN_LABELS[domain]}</span>
            {count > 0 && (
              <span
                style={{
                  background: active ? color : '#334155',
                  color: active ? '#fff' : '#94a3b8',
                  borderRadius: '10px',
                  padding: '0 6px',
                  fontSize: '10px',
                  fontWeight: 700,
                  minWidth: '20px',
                  textAlign: 'center',
                }}
              >
                {count > 9999 ? '9999+' : count}
              </span>
            )}
          </button>
        );
      })}

      {/* Clear all */}
      {!noneActive && !allActive && (
        <>
          <div style={{ width: '1px', height: '20px', background: '#1e293b', margin: '0 2px' }} />
          <button
            onClick={onClearAll}
            title="Hide all layers"
            style={{
              ...pillBase,
              background: 'transparent',
              color: '#7d8ba1',
              border: '1px solid transparent',
              fontSize: '11px',
              padding: '3px 8px',
            }}
          >
            Clear
          </button>
        </>
      )}

      {/* The view is remembered across refreshes, so say so when it isn't the default: otherwise a
          filter from yesterday looks like missing data. */}
      {!viewIsDefault && (
        <button
          onClick={onResetView}
          title={`Your saved view is active (${viewSummary}). Click to return to the default view.`}
          style={{
            ...pillBase, flexShrink: 0, background: '#422006', color: '#fbbf24',
            border: '1px solid #92400e', fontSize: '11px', padding: '3px 10px', marginLeft: 'auto',
          }}
        >
          ↺ Filters active · Reset view
        </button>
      )}

      {/* Time window — pushed to the right edge */}
      <div
        role="group"
        aria-label="Time window"
        style={{
          marginLeft: viewIsDefault ? 'auto' : '8px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '2px',
          background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '2px',
          // The chips row scrolls sideways when there are many domains; keep this control pinned
          // to the right edge (with a soft fade) instead of letting it scroll out of view.
          ...(isMobile ? { position: 'sticky' as const, right: 0, zIndex: 2, boxShadow: '-10px 0 8px 2px rgba(10,15,30,0.95)' } : {}),
        }}
      >
        <span style={{ fontSize: '10px', color: '#8a99ae', padding: '0 6px 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Last</span>
        {TIME_WINDOWS.map(w => {
          const on = w.id === timeWindow;
          return (
            <button
              key={w.id}
              onClick={() => onTimeWindow(w.id)}
              aria-pressed={on}
              title={`Show events from the last ${w.label}`}
              style={{
                border: 'none', cursor: 'pointer', borderRadius: '10px',
                padding: '3px 9px', fontSize: '11px', fontWeight: 600,
                background: on ? '#334155' : 'transparent',
                color: on ? '#e2e8f0' : '#64748b',
              }}
            >
              {w.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Shared pill styles ────────────────────────────────────

const pillBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  padding: '4px 10px',
  borderRadius: '20px',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'all 0.15s ease',
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
  flexShrink: 0,
};
