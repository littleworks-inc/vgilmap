/**
 * DomainFilter.tsx
 *
 * A pill-button row that sits at the top of the map area.
 * Each pill represents one VigilEvent domain. Clicking toggles it.
 * Active domains are highlighted with their domain colour.
 */

import type { Domain } from '../types';
import { DOMAIN_COLORS, DOMAIN_ICONS } from '../types';

// ─── Domain display config ─────────────────────────────────

const DOMAIN_LABELS: Record<Domain, string> = {
  disaster: 'Earthquakes',
  climate:  'Climate',
  health:   'Health',
  conflict: 'Conflict',
  economic: 'Economic',
  labor:    'Labor',
  science:  'Science',
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
];

// ─── Component ─────────────────────────────────────────────

interface DomainFilterProps {
  activeDomains: Set<Domain>;
  counts: Partial<Record<Domain, number>>;
  onToggle: (domain: Domain) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export function DomainFilter({
  activeDomains,
  counts,
  onToggle,
  onSelectAll,
  onClearAll,
}: DomainFilterProps) {
  const allActive = VISIBLE_DOMAINS.every(d => activeDomains.has(d));
  const noneActive = VISIBLE_DOMAINS.every(d => !activeDomains.has(d));

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
        padding: '8px 12px',
        background: 'rgba(10,15,30,0.88)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #1e293b',
        zIndex: 10,
        position: 'relative',
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
      {VISIBLE_DOMAINS.map(domain => {
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
              color: '#475569',
              border: '1px solid transparent',
              fontSize: '11px',
              padding: '3px 8px',
            }}
          >
            Clear
          </button>
        </>
      )}
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
};
