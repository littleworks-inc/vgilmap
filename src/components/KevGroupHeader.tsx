import { DOMAIN_ICONS, NO_MAP_LOCATION } from '../types';

/** Header row of the collapsible "Exploited vulnerabilities" group (CISA KEV entries). */
export function KevGroupHeader({
  count,
  newestAgo,
  open,
  onToggle,
  padding = '10px 16px',
}: {
  count: number;
  newestAgo: string;
  open: boolean;
  onToggle: () => void;
  padding?: string;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      title="CISA's Known Exploited Vulnerabilities catalogue. These are software flaws, so they have no map location."
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', gap: '10px', alignItems: 'center',
        padding, background: '#0f172a', border: 'none', borderLeft: '3px solid #84cc16',
        borderBottom: '1px solid #1e293b',
      }}
    >
      <span style={{ fontSize: '16px', flexShrink: 0 }}>{DOMAIN_ICONS.cyber}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
          Exploited vulnerabilities · {count}
        </span>
        <span style={{ display: 'block', fontSize: '11px', color: '#8a99ae', marginTop: '2px' }}>
          CISA KEV · newest {newestAgo} · {NO_MAP_LOCATION}
        </span>
      </span>
      <span aria-hidden style={{ fontSize: '11px', color: '#7d8ba1' }}>{open ? '▲' : '▼'}</span>
    </button>
  );
}
