import { useEffect, useMemo, useState } from 'react';
import { usePersistedBool } from '../hooks/usePersistedBool';
import type { CyberFocus, CyberFocusDimension } from '../types';

interface Trend {
  key: string;
  recent: number;
  expected: number;
  ratio: number;
  score: number;
}

interface TrendsResponse {
  configured: boolean;
  error?: string;
  window?: { recentDays: number; baselineDays: number; daysWithData: number };
  daily?: Array<{ day: string; total: number }>;
  countries?: Trend[];
  sectors?: Trend[];
  groups?: Trend[];
}

type Tab = CyberFocusDimension;

const ACCENT = '#84cc16';
// Below this many days of stored history the baseline is too thin to trust the ratios.
const MIN_RELIABLE_DAYS = 60;
const REFRESH_MS = 30 * 60 * 1000;

const regionNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; }
})();

function label(tab: Tab, key: string): string {
  if (tab === 'countries') {
    if (key === '??') return 'Unknown';
    try { return regionNames?.of(key) ?? key; } catch { return key; }
  }
  return key;
}

// ─── Sparkline ─────────────────────────────────────────────

function Sparkline({ values, recentDays }: { values: number[]; recentDays: number }) {
  const w = 240;
  const h = 36;
  const max = Math.max(1, ...values);
  const step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 6)).toFixed(1)}`);
  const recentX = (values.length - recentDays) * step;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img"
         aria-label="Daily ransomware claims over the last 97 days">
      <rect x={recentX} y={0} width={w - recentX} height={h} fill={`${ACCENT}14`} />
      <polyline points={pts.join(' ')} fill="none" stroke={ACCENT} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Panel ─────────────────────────────────────────────────

interface CyberTrendsPanelProps {
  focus: CyberFocus | null;
  onFocus: (focus: CyberFocus | null) => void;
}

export function CyberTrendsPanel({ focus, onFocus }: CyberTrendsPanelProps) {
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [expanded, setExpanded] = usePersistedBool('vigil.cybertrends.open', false);
  const [tab, setTab] = useState<Tab>('sectors');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/cyber-trends');
        if (!res.ok) return;
        const json = (await res.json()) as TrendsResponse;
        if (!cancelled) setData(json);
      } catch {
        /* panel simply stays hidden */
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const rows = useMemo(() => (data?.[tab] ?? []).slice(0, 6), [data, tab]);

  // Hidden until the backend is configured and has data.
  if (!data?.configured || data.error || !data.window || data.window.daysWithData === 0) return null;

  const thin = data.window.daysWithData < MIN_RELIABLE_DAYS;
  const total7 = (data.daily ?? []).slice(-data.window.recentDays).reduce((n, d) => n + d.total, 0);

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
          🛡️ Cyber Trends
          <span style={{
            background: '#1e293b', border: '1px solid #334155', color: '#8a99ae',
            borderRadius: '10px', padding: '0 6px', fontSize: '10px',
          }}>
            {total7} claims / 7d
          </span>
        </span>
        <span style={{ fontSize: '10px', color: '#7d8ba1' }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 12px 8px' }}>
          {data.daily && <Sparkline values={data.daily.map(d => d.total)} recentDays={data.window.recentDays} />}
          <div style={{ fontSize: '9px', color: '#7d8ba1', display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span>{data.window.recentDays + data.window.baselineDays}d history</span>
            <span>last {data.window.recentDays}d shaded</span>
          </div>

          <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
            {(['sectors', 'countries', 'groups'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1, fontSize: '10px', fontWeight: 600, padding: '3px 0', cursor: 'pointer',
                  borderRadius: '4px', textTransform: 'capitalize',
                  border: `1px solid ${tab === t ? ACCENT : '#334155'}`,
                  background: tab === t ? `${ACCENT}1f` : 'transparent',
                  color: tab === t ? ACCENT : '#64748b',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <div style={{ fontSize: '11px', color: '#8a99ae', padding: '4px 0' }}>
              Nothing running above its normal level.
            </div>
          ) : (
            rows.map(r => {
              const hot = r.score >= 4;
              const active = focus?.dimension === tab && focus.key === r.key;
              return (
                <button
                  key={r.key}
                  onClick={() => onFocus(active ? null : { dimension: tab, key: r.key, label: label(tab, r.key) })}
                  title={active ? 'Click to clear this filter' : 'Show these claims on the map'}
                  aria-pressed={active}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', textAlign: 'left', cursor: 'pointer',
                    padding: '4px 4px 4px 8px', borderLeft: `3px solid ${hot ? '#ef4444' : '#f97316'}`,
                    borderTop: 'none', borderRight: 'none', borderBottom: '1px solid #0f172a',
                    marginBottom: '2px', background: active ? `${ACCENT}1f` : 'transparent',
                  }}
                >
                  <span style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: 600 }}>
                    {label(tab, r.key)}
                  </span>
                  <span style={{ fontSize: '11px', color: '#8a99ae', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {r.recent} vs ~{r.expected} typical
                    <span style={{
                      fontSize: '10px', fontWeight: 700, padding: '1px 5px', borderRadius: '4px',
                      color: hot ? '#ef4444' : '#f97316',
                      border: `1px solid ${hot ? '#ef444466' : '#f9731666'}`,
                      background: hot ? '#ef444411' : '#f9731611',
                    }}>
                      {r.ratio >= 10 ? `${Math.round(r.ratio)}×` : `${r.ratio.toFixed(1)}×`}
                    </span>
                  </span>
                </button>
              );
            })
          )}

          {thin && (
            <div style={{ fontSize: '10px', color: '#a16207', marginTop: '6px', lineHeight: 1.4 }}>
              Only {data.window.daysWithData} days of history stored. Ratios are inflated until the
              backfill covers ~{MIN_RELIABLE_DAYS}+ days.
            </div>
          )}
          <div style={{ fontSize: '9px', color: '#7d8ba1', marginTop: '6px' }}>
            Click a row to filter the map to its latest claims. Claims posted by ransomware groups (ransomware.live); not victim-confirmed. Compared with the prior {data.window.baselineDays}-day weekly average.
          </div>
        </div>
      )}
    </div>
  );
}
