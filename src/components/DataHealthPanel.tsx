import { useEffect, useState } from 'react';
import { usePersistedBool } from '../hooks/usePersistedBool';
import { DOMAIN_COLORS } from '../types';
import { PRECISION_META } from '../../shared/pipeline/precision';
import { STATUS_META, ago, summarize } from '../health/sourceHealth';
import type { SourceHealth } from '../health/sourceHealth';
import type { Domain } from '../types';

/**
 * Shows, per data source, whether it is live, partial, stale, empty or down — so a quiet map
 * can be told apart from a broken feed. Collapsed by default; the header badge stays visible
 * and turns amber/red when something needs attention.
 */
/** A source still loading after this long is called out as slow instead of showing a bare spinner. */
const SLOW_AFTER_S = 15;

interface DataHealthPanelProps {
  sources: SourceHealth[];
  /** Events per source in the CURRENT view (time window + selected domains), keyed by source key. */
  viewCounts: Record<string, number>;
  /** Domains currently switched on in the top filter bar. */
  activeDomains: Set<Domain>;
}

export function DataHealthPanel({ sources, viewCounts, activeDomains }: DataHealthPanelProps) {
  const [expanded, setExpanded] = usePersistedBool('vigil.health.open', false);
  const [coverageKey, setCoverageKey] = useState<string | null>(null); // which row shows its coverage note

  // Re-render so "3m ago" stays honest: every 30s normally, every second while a source is
  // still loading so its elapsed-time counter runs.
  const anyLoading = sources.some(s => s.status === 'loading');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), anyLoading ? 1_000 : 30_000);
    return () => clearInterval(t);
  }, [anyLoading]);

  const { live, total, worst } = summarize(sources);
  const allLoading = sources.every(s => s.status === 'loading');
  const badgeColor = allLoading ? STATUS_META.loading.color : STATUS_META[worst === 'loading' ? 'ok' : worst].color;
  const attention = sources.filter(s => !s.optional && (s.status === 'error' || s.status === 'stale' || s.status === 'empty' || s.status === 'degraded')).length;

  return (
    <div style={{ borderBottom: '1px solid #1e293b', background: '#0a0f1e' }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          padding: '8px 12px', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
          📡 Data Health
          <span
            title={allLoading ? 'Checking sources…' : `${live} of ${total} sources returning data`}
            style={{
              background: `${badgeColor}1a`, border: `1px solid ${badgeColor}`, color: badgeColor,
              borderRadius: '10px', padding: '0 6px', fontSize: '10px', fontWeight: 700,
            }}
          >
            {allLoading ? 'checking…' : `${live}/${total} live`}
          </span>
          {!allLoading && attention > 0 && (
            <span style={{ fontSize: '10px', color: '#8a99ae', fontWeight: 400 }}>
              {attention} need{attention === 1 ? 's' : ''} attention
            </span>
          )}
        </span>
        <span style={{ fontSize: '10px', color: '#7d8ba1' }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 12px 8px' }}>
          {sources.map(s => {
            // An optional source that's down is a non-event: muted colour, "Unavailable", and a note.
            const quiet = s.optional && s.status === 'error' && !s.retained;
            const meta = quiet
              ? { label: 'Unavailable', color: '#94a3b8', hint: 'Optional extra source; nothing depends on it' }
              : STATUS_META[s.status];
            const elapsed = s.status === 'loading' && s.startedAt ? Math.max(0, Math.round((now - s.startedAt) / 1000)) : 0;
            const slow = s.status === 'loading' && elapsed >= SLOW_AFTER_S;
            const detail =
              s.status === 'loading' ? (slow ? `still waiting after ${elapsed}s — this source is slow` : null)
              : s.status === 'error' ? (s.retained ? `${s.error} · still showing the last good data (${s.count} events${s.dataAt ? `, fetched ${ago(now - s.dataAt)}` : ''})` : quiet ? `${s.error} · optional extra, nothing depends on it` : s.error)
              : s.status === 'stale' && s.newestAt ? `newest event is ${ago(now - new Date(s.newestAt).getTime())}`
              : s.status === 'empty' ? 'responded with no events'
              : s.warnings.length > 0 ? s.warnings.join(' · ')
              : null;
            const lastOk =
              (s.status === 'error' || s.status === 'empty') && s.lastOkAt
                ? `last had data ${ago(now - s.lastOkAt)}`
                : null;

            const hidden = !activeDomains.has(s.domain); // its domain is switched off in the top filter bar
            const inView = viewCounts[s.key] ?? 0;
            return (
              <div
                key={s.key}
                title={`${meta.label}: ${meta.hint} · ${s.count} returned in total (all ages), ${inView} in the current view${hidden ? ' (domain hidden)' : ''}${s.durationMs != null ? ` · responded in ${(s.durationMs / 1000).toFixed(1)}s` : ''}`}
                onClick={() => setCoverageKey(k => (k === s.key ? null : s.key))}
                style={{ padding: '5px 0 5px 8px', borderLeft: `3px solid ${meta.color}`, borderBottom: '1px solid #0f172a', marginBottom: '2px', opacity: hidden ? 0.45 : 1, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    <span aria-hidden style={{ width: 6, height: 6, borderRadius: 2, background: DOMAIN_COLORS[s.domain], flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                  </span>
                  <span style={{ fontSize: '11px', color: '#8a99ae', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    {s.status === 'ok' || s.status === 'degraded' || s.status === 'stale' || (s.status === 'error' && s.retained)
                      ? <>{hidden ? 'hidden' : inView}{s.newestAt ? <span> · {ago(now - new Date(s.newestAt).getTime())}</span> : null}</>
                      : null}
                    <span style={{
                      fontSize: '10px', fontWeight: 700, padding: '1px 5px', borderRadius: '4px',
                      color: slow ? '#eab308' : meta.color, border: `1px solid ${slow ? '#eab308' : meta.color}66`, background: `${slow ? '#eab308' : meta.color}11`,
                    }}>
                      {s.status === 'loading' ? (slow ? `Slow · ${elapsed}s` : `Loading · ${elapsed}s`) : s.retained ? 'Stale · refresh failed' : meta.label}
                    </span>
                  </span>
                </div>
                {coverageKey === s.key && s.coverage && (
                  <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '3px', lineHeight: 1.4 }}>
                    <b style={{ color: '#cbd5e1' }}>Coverage:</b> {s.coverage}
                    {s.precision && <><br /><b style={{ color: '#cbd5e1' }}>Location:</b> {PRECISION_META[s.precision].label} — {PRECISION_META[s.precision].hint}</>}
                    {s.refreshSeconds && <><br /><b style={{ color: '#cbd5e1' }}>Refreshes:</b> every {s.refreshSeconds >= 3600 ? `${Math.round(s.refreshSeconds / 3600)} h` : `${Math.round(s.refreshSeconds / 60)} min`}</>}
                  </div>
                )}
                {(detail || lastOk) && (
                  <div style={{ fontSize: '10px', color: '#7d8ba1', marginTop: '2px', lineHeight: 1.35, wordBreak: 'break-word' }}>
                    {detail}{detail && lastOk ? ' · ' : ''}{lastOk}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ fontSize: '9px', color: '#7d8ba1', marginTop: '6px', lineHeight: 1.4 }}>
            Counts are events from each source in the current view (time window and selected domains);
            hover a row for its all-age total; click a row for its coverage and location accuracy. “Down” means the request failed; “No data” means it
            succeeded but returned nothing; “Stale” means only old events came back.
          </div>
        </div>
      )}
    </div>
  );
}
