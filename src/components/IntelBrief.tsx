/**
 * IntelBrief.tsx
 *
 * AI-powered World Brief panel — sits at the top of the Sidebar,
 * below the VigilMap header, above the event list.
 *
 * Layout:
 * ┌─────────────────────────────────────┐
 * │ 🧠 World Brief  [✨ AI]  [Generate] │
 * ├─────────────────────────────────────┤
 * │ Brief text appears here...          │
 * │                                     │
 * │ Generated 2 min ago          [↺]   │
 * └─────────────────────────────────────┘
 *
 * Source badges:
 *   ✨ AI   — brief came from an AI model via /api/brief
 *   📊 Auto — brief was generated locally (all models unavailable)
 *
 * Cooldown: Generate/Regenerate is disabled for 30 s after each click,
 * showing a live countdown so the user knows when it will re-enable.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { generateBrief } from '../intelligence/briefs';
import type { BriefSource } from '../intelligence/briefs';
import type { VigilEvent } from '../types';
import { anomalySummary } from '../intelligence/anomaly';
import type { AnomalySignal } from '../intelligence/anomaly';

// ─── helpers ───────────────────────────────────────────────

function timeAgo(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

const REFRESH_AFTER_MS = 10 * 60 * 1000; // 10 minutes
const COOLDOWN_SEC     = 30;              // seconds between Generate clicks

// ─── component ─────────────────────────────────────────────

interface IntelBriefProps {
  events: VigilEvent[];
  anomalySignals?: AnomalySignal[];
}

const BRIEF_STORAGE_KEY = 'vigil.brief.v1';

/** The last brief, if it is still fresh. Regenerating costs an API call and hits a rate limit. */
function loadStoredBrief(): { brief: string; source: BriefSource; time: Date } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(BRIEF_STORAGE_KEY) ?? 'null') as { brief?: string; source?: BriefSource; time?: number } | null;
    if (!raw?.brief || !raw.time || Date.now() - raw.time > REFRESH_AFTER_MS) return null;
    return { brief: raw.brief, source: raw.source === 'ai' ? 'ai' : 'local', time: new Date(raw.time) };
  } catch {
    return null;
  }
}

export function IntelBrief({ events, anomalySignals }: IntelBriefProps) {
  const [stored] = useState(loadStoredBrief); // read once, on mount
  const [brief, setBrief]             = useState<string | null>(stored?.brief ?? null);
  const [source, setSource]           = useState<BriefSource>(stored?.source ?? 'local');
  const [loading, setLoading]         = useState(false);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(stored?.time ?? null);
  const [expanded, setExpanded]       = useState(stored != null);
  const [cooldown, setCooldown]       = useState(0); // seconds remaining

  // Stable cache ref so rapid re-renders don't lose the last brief
  const cacheRef = useRef<{ brief: string; source: BriefSource; time: Date } | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isOld   = generatedAt
    ? Date.now() - generatedAt.getTime() > REFRESH_AFTER_MS
    : false;

  // ── cooldown ticker ───────────────────────────────────────

  const startCooldown = useCallback(() => {
    setCooldown(COOLDOWN_SEC);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          cooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Clean up interval on unmount
  useEffect(() => () => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
  }, []);

  // ── generate handler ──────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (loading || cooldown > 0) return;

    setLoading(true);
    setExpanded(true);
    startCooldown();

    const anomalyCtx = anomalySignals?.length
      ? ' Event concentrations (relative to other regions now, not historical): ' + anomalySummary(anomalySignals)
      : '';
    const result = await generateBrief(events, 'Global' + anomalyCtx);

    setBrief(result.brief);
    setSource(result.source);
    const now = new Date();
    setGeneratedAt(now);
    cacheRef.current = { brief: result.brief, source: result.source, time: now };
    try {
      localStorage.setItem(BRIEF_STORAGE_KEY, JSON.stringify({ brief: result.brief, source: result.source, time: now.getTime() }));
    } catch { /* storage unavailable: the brief just won't survive a refresh */ }
    setLoading(false);
  }, [events, loading, cooldown, startCooldown]);

  // ── button label ──────────────────────────────────────────

  let buttonLabel: string;
  if (loading)        buttonLabel = 'Analyzing…';
  else if (cooldown > 0) buttonLabel = `Wait ${cooldown}s`;
  else if (brief)     buttonLabel = 'Regenerate';
  else                buttonLabel = 'Generate';

  const buttonDisabled = loading || cooldown > 0;

  // ─── render ───────────────────────────────────────────────
  return (
    <div
      style={{
        margin: '10px 12px 0',
        background: 'rgba(15, 23, 42, 0.8)',
        border: '1px solid #1e293b',
        borderRadius: '8px',
        overflow: 'hidden',
        fontSize: '13px',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '9px 12px',
          cursor: brief ? 'pointer' : 'default',
          userSelect: 'none',
        }}
        onClick={() => brief && setExpanded(e => !e)}
      >
        {/* Left: icon + title + source badge + collapse arrow */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', fontWeight: 600 }}>
          <span>🧠</span>
          <span>World Brief</span>

          {/* Source badge — only when a brief exists and is not the no-key message */}
          {brief && (
            <span
              style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '10px',
                background: source === 'ai' ? '#0f2a1a' : '#1a1a0f',
                border: `1px solid ${source === 'ai' ? '#166534' : '#713f12'}`,
                color: source === 'ai' ? '#4ade80' : '#facc15',
                fontWeight: 500,
              }}
            >
              {source === 'ai' ? '✨ AI' : '📊 Auto'}
            </span>
          )}

          {/* Collapse arrow */}
          {brief && (
            <span
              style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '10px',
                background: '#0f172a',
                border: '1px solid #1e293b',
                color: '#7d8ba1',
                fontWeight: 400,
              }}
            >
              {expanded ? '▲' : '▼'}
            </span>
          )}
        </span>

        {/* Right: Generate / Regenerate / cooldown button */}
        <button
          onClick={e => { e.stopPropagation(); handleGenerate(); }}
          disabled={buttonDisabled}
          style={{
            background: buttonDisabled ? 'transparent' : '#1e3a5f',
            border: `1px solid ${buttonDisabled ? '#334155' : '#3b82f6'}`,
            borderRadius: '5px',
            color: buttonDisabled ? '#475569' : '#60a5fa',
            cursor: buttonDisabled ? 'default' : 'pointer',
            fontSize: '11px',
            fontWeight: 600,
            padding: '3px 10px',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
            minWidth: '74px',
            textAlign: 'center',
          }}
        >
          {buttonLabel}
        </button>
      </div>

      {/* Body — only shown when expanded or while loading */}
      {(expanded || loading) && (
        <div
          style={{
            padding: '0 12px 10px',
            borderTop: '1px solid #1e293b',
          }}
        >
          {/* Loading state */}
          {loading && (
            <div
              style={{
                padding: '10px 0',
                color: '#7d8ba1',
                fontStyle: 'italic',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            >
              <style>{`
                @keyframes pulse {
                  0%, 100% { opacity: 1; }
                  50% { opacity: 0.4; }
                }
              `}</style>
              Analyzing {events.length} events…
            </div>
          )}

          {/* Brief text */}
          {!loading && brief && (
            <>
              <p
                style={{
                  margin: '10px 0 8px',
                  color: '#cbd5e1',
                  lineHeight: 1.65,
                                    whiteSpace: 'pre-wrap',
                }}
              >
                {brief}
              </p>

              {/* Footer: timestamp + optional refresh */}
              {generatedAt && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: '6px',
                  }}
                >
                  <span style={{ color: '#334155', fontSize: '11px' }}>
                    Generated {timeAgo(generatedAt)}
                  </span>

                  {isOld && cooldown === 0 && (
                    <button
                      onClick={handleGenerate}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#3b82f6',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: 0,
                        fontFamily: 'inherit',
                      }}
                    >
                      ↺ Refresh
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
