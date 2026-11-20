/**
 * briefs.ts — AI-powered global intelligence briefs.
 *
 * The browser never talks to the LLM provider directly: it posts a trimmed
 * event list to /api/brief (api/brief.ts), which holds the NVIDIA_API_KEY and
 * walks the model cascade server-side. If that fails for any reason we fall
 * back to a locally generated summary.
 */

import type { VigilEvent } from '../types';
import { SEVERITY_ORDER } from '../types';

// ─── Types ─────────────────────────────────────────────────

export type BriefSource = 'ai' | 'local';

export interface BriefResult {
  brief: string;
  source: BriefSource;
}

const TOP_N = 8;
const REQUEST_TIMEOUT_MS = 30_000; // server tries up to 3 models at 8s each

// ─── Local fallback summary ─────────────────────────────────

/**
 * Produces a plain-text summary from the event list without any AI call.
 * Used when the AI proxy is unavailable.
 */
function localSummary(events: VigilEvent[]): string {
  if (events.length === 0) return 'No active events to summarise.';

  // Count by domain
  const domainCounts: Record<string, number> = {};
  for (const ev of events) {
    domainCounts[ev.domain] = (domainCounts[ev.domain] ?? 0) + 1;
  }
  const domainLine = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => `${n} ${d}`)
    .join(', ');

  // Top 3 critical/high events
  const urgent = [...events]
    .filter(e => e.severity === 'critical' || e.severity === 'high')
    .sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity])
    .slice(0, 3);

  const lines = [`${events.length} active events across ${domainLine}.`];
  if (urgent.length > 0) {
    lines.push(
      'Most significant: ' +
        urgent.map(e => `${e.title} (${e.location.label})`).join('; ') +
        '.'
    );
  }

  return lines.join(' ');
}

// ─── Main export ───────────────────────────────────────────

/**
 * Generate a brief summarising the top events.
 *
 * @param events  Full filtered event list (trimmed to top 8 by severity)
 * @param context Label for the region/scope, e.g. "Global" or "Southeast Asia"
 */
export async function generateBrief(
  events: VigilEvent[],
  context: string
): Promise<BriefResult> {
  // Top 8 events, 3 fields only — keeps the prompt small and limits what leaves the browser
  const top = [...events]
    .sort((a, b) => {
      const severityDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })
    .slice(0, TOP_N)
    .map(e => ({ title: e.title, severity: e.severity, location: e.location.label }));

  try {
    const res = await fetch('/api/brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: top, context }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`/api/brief ${res.status}`);
    const { brief } = (await res.json()) as { brief?: string };
    if (!brief) throw new Error('empty brief');
    return { brief, source: 'ai' };
  } catch (err) {
    console.warn('[briefs] AI unavailable, using local summary:', err);
    return { brief: localSummary(events), source: 'local' };
  }
}
