import { useState } from 'react';
import type { AnomalySignal } from '../intelligence/anomaly';
import { DOMAIN_COLORS } from '../intelligence/anomaly';

interface AnomalyPanelProps {
  signals: AnomalySignal[];
  onSelectSignal: (signal: AnomalySignal) => void;
}

const SEV_COLOR = {
  critical:    '#7c3aed',
  significant: '#ef4444',
  elevated:    '#f97316',
};

const SEV_ICON = {
  critical:    '🔴',
  significant: '🟠',
  elevated:    '🟡',
};

export function AnomalyPanel({ signals, onSelectSignal }: AnomalyPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (signals.length === 0) return null;

  const top = signals.slice(0, 5);
  const critCount = signals.filter(s => s.severity === 'critical').length;

  return (
    <div style={{
      borderBottom: '1px solid #1e293b',
      background: '#0a0f1e',
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8',
                       display: 'flex', alignItems: 'center', gap: '6px' }}>
          ⚡ Anomaly Signals
          {critCount > 0 && (
            <span style={{
              background: '#7c3aed22',
              border: '1px solid #7c3aed',
              color: '#a78bfa',
              borderRadius: '10px',
              padding: '0 6px',
              fontSize: '10px',
              fontWeight: 700,
            }}>
              {critCount} critical
            </span>
          )}
          {critCount === 0 && (
            <span style={{
              background: '#1e293b',
              border: '1px solid #334155',
              color: '#64748b',
              borderRadius: '10px',
              padding: '0 6px',
              fontSize: '10px',
            }}>
              {signals.length}
            </span>
          )}
        </span>
        <span style={{ fontSize: '10px', color: '#475569' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Signal cards */}
      {expanded && (
        <div style={{ paddingBottom: '4px' }}>
          {top.map(signal => {
            const domainColor = DOMAIN_COLORS[signal.domain] ?? '#6b7280';
            const sevColor = SEV_COLOR[signal.severity];
            return (
              <button
                key={signal.id}
                onClick={() => onSelectSignal(signal)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  borderLeft: `3px solid ${sevColor}`,
                  borderBottom: '1px solid #0f172a',
                  padding: '7px 12px 7px 10px',
                  cursor: 'pointer',
                  marginBottom: '2px',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e =>
                  (e.currentTarget.style.background = '#172033')}
                onMouseLeave={e =>
                  (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}>
                    {SEV_ICON[signal.severity]}
                    <span style={{ color: domainColor }}>
                      {signal.label}
                    </span>
                  </span>
                </div>
                <div style={{
                  fontSize: '11px', color: '#64748b',
                  marginTop: '2px', display: 'flex',
                  alignItems: 'center', gap: '6px',
                }}>
                  {signal.count} events
                  <span style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    letterSpacing: '0.6px',
                    padding: '1px 5px',
                    borderRadius: '4px',
                    border: `1px solid ${sevColor}66`,
                    color: sevColor,
                    background: `${sevColor}11`,
                    textTransform: 'uppercase',
                  }}>
                    {signal.severity === 'critical'    ? '⚠ Extreme'  :
                     signal.severity === 'significant' ? '↑ Elevated' :
                                                         '~ Mild'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
