import type { ListFilter } from '../utils/listRows';

/** "All / On map / No location" switch above an event list, with a count on each choice. */
export function ListFilterBar({
  counts,
  value,
  onChange,
  compact = false,
}: {
  counts: { all: number; map: number; nomap: number };
  value: ListFilter;
  onChange: (next: ListFilter) => void;
  /** Taller tap targets, for the touch layout. */
  compact?: boolean;
}) {
  const TITLES: Record<ListFilter, string> = {
    all: 'Every event in view, plotted or not',
    map: 'Only events plotted on the globe',
    nomap: 'Only events with no map location (shown in the list only)',
  };
  const choices: Array<[ListFilter, string, number]> = [
    ['all', 'All', counts.all],
    ['map', 'On map', counts.map],
    ['nomap', 'No location', counts.nomap],
  ];
  return (
    <div role="group" aria-label="Filter the list by map location" style={{ display: 'flex', gap: '4px', padding: compact ? '8px 16px' : '0 12px 8px' }}>
      {choices.map(([id, label, n]) => {
        const on = value === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            aria-pressed={on}
            title={TITLES[id]}
            style={{
              flex: 1, fontSize: compact ? '12px' : '11px', fontWeight: 600, padding: compact ? '8px 0' : '4px 0',
              cursor: 'pointer', borderRadius: '6px', whiteSpace: 'nowrap',
              border: `1px solid ${on ? '#3b82f6' : '#334155'}`,
              background: on ? '#1e3a5f' : 'transparent',
              color: on ? '#e2e8f0' : '#8a99ae',
            }}
          >
            {label} <span style={{ fontWeight: 500, opacity: 0.85 }}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}
