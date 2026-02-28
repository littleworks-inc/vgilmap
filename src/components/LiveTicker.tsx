/**
 * LiveTicker — scrolling event feed at bottom of screen.
 * Cycles through recent high/critical events every 4 seconds.
 */
import { useState, useEffect, useRef } from 'react';
import type { VigilEvent } from '../types';
import { DOMAIN_COLORS, DOMAIN_ICONS } from '../types';
interface Props {
  events: VigilEvent[];
  onSelectEvent?: (ev: VigilEvent) => void;
}
const SEVERITY_ORDER: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
};
export function LiveTicker({ events, onSelectEvent }: Props) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Sort: critical/high first, then by recency
  const tickerEvents = [...events]
    .filter(e => e.severity === 'critical' || e.severity === 'high' || e.severity === 'medium')
    .sort((a, b) => {
      const sd = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
      if (sd !== 0) return sd;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })
    .slice(0, 30);
  useEffect(() => {
    if (tickerEvents.length === 0) return;
    intervalRef.current = setInterval(() => {
      // Fade out
      setVisible(false);
      setTimeout(() => {
        setIndex(i => (i + 1) % tickerEvents.length);
        setVisible(true);
      }, 350);
    }, 4000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [tickerEvents.length]);
  if (tickerEvents.length === 0) return null;
  const ev = tickerEvents[index % tickerEvents.length];
  if (!ev) return null;
  const color = DOMAIN_COLORS[ev.domain] ?? '#6b7280';
  const icon = DOMAIN_ICONS[ev.domain] ?? '🌐';
  const age = Math.round((Date.now() - new Date(ev.timestamp).getTime()) / 60000);
  const ageLabel = age < 60
    ? `${age}m ago`
    : age < 1440 ? `${Math.round(age / 60)}h ago`
    : `${Math.round(age / 1440)}d ago`;
  const severityDot = ev.severity === 'critical' ? '#7c3aed'
    : ev.severity === 'high' ? '#ef4444' : '#f97316';
  // suppress unused warning — color is available for future use
  void color;
  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: '36px',
      background: 'rgba(10,15,30,0.92)',
      borderTop: '1px solid #1e293b',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '0 16px',
      zIndex: 10,
      backdropFilter: 'blur(8px)',
      userSelect: 'none',
    }}>
      {/* LIVE badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        flexShrink: 0,
      }}>
        <div style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: '#22c55e',
          boxShadow: '0 0 6px #22c55e',
          animation: 'livePulse 1.5s ease-in-out infinite',
        }} />
        <span style={{
          fontSize: '9px', fontWeight: 700, letterSpacing: '1.5px',
          color: '#22c55e', fontFamily: 'monospace',
        }}>LIVE</span>
      </div>
      <div style={{ width: '1px', height: '18px', background: '#1e293b', flexShrink: 0 }} />
      {/* Scrolling event */}
      <div
        onClick={() => onSelectEvent?.(ev)}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          cursor: 'pointer',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.35s ease',
          minWidth: 0,
        }}
      >
        {/* Severity dot */}
        <div style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: severityDot, flexShrink: 0,
          boxShadow: `0 0 5px ${severityDot}`,
        }} />
        {/* Domain icon + title */}
        <span style={{ fontSize: '12px', flexShrink: 0 }}>{icon}</span>
        <span style={{
          fontSize: '12px', color: '#e2e8f0',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          fontWeight: 500,
        }}>
          {ev.title}
        </span>
        {/* Location */}
        {ev.location.label && (
          <span style={{
            fontSize: '11px', color: '#64748b',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            — {ev.location.label}
          </span>
        )}
      </div>
      {/* Right side: age + counter */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '11px', color: '#475569', fontFamily: 'monospace' }}>
          {ageLabel}
        </span>
        <span style={{ fontSize: '11px', color: '#334155' }}>
          {index + 1}/{tickerEvents.length}
        </span>
      </div>
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>
    </div>
  );
}
