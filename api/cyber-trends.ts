/**
 * GET /api/cyber-trends — which countries / sectors / groups are running above normal.
 *
 * Compares the last 7 days against the weekly average of the preceding 90 days.
 *   score = (recent − expected) / sqrt(expected + 1)   (≈ z-score for Poisson counts)
 * Entries need ≥ 3 recent claims to appear, so tiny counts don't produce noise.
 * Falls back to { configured: false } if Redis isn't set up yet.
 */
export const config = { runtime: 'edge' };

import { getRedis, readDays } from './_lib/cyber-store';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const RECENT_DAYS = 7;
const BASELINE_DAYS = 90;
const MIN_RECENT = 3;
const MIN_SCORE = 1.5;
const TOP_N = 10;

interface Trend {
  key: string;
  recent: number;
  expected: number;
  ratio: number;
  score: number;
}

function trends(
  rows: Array<{ counts: Record<string, number> }>,
  prefix: string,
): Trend[] {
  const split = rows.length - RECENT_DAYS;
  const recent: Record<string, number> = {};
  const base: Record<string, number> = {};
  rows.forEach((row, i) => {
    const target = i >= split ? recent : base;
    for (const [field, n] of Object.entries(row.counts)) {
      if (field.startsWith(prefix)) {
        const k = field.slice(prefix.length);
        target[k] = (target[k] ?? 0) + n;
      }
    }
  });
  const weeks = BASELINE_DAYS / 7;
  return Object.entries(recent)
    .filter(([, r]) => r >= MIN_RECENT)
    .map(([key, r]) => {
      const expected = (base[key] ?? 0) / weeks;
      return {
        key,
        recent: r,
        expected: Math.round(expected * 10) / 10,
        ratio: Math.round((r / Math.max(expected, 0.5)) * 10) / 10,
        score: Math.round(((r - expected) / Math.sqrt(expected + 1)) * 10) / 10,
      };
    })
    .filter(t => t.score >= MIN_SCORE) // only genuinely elevated, never at/below baseline
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let redis;
  try {
    redis = getRedis();
  } catch {
    return new Response(JSON.stringify({ configured: false }), { status: 200, headers: CORS });
  }

  try {
    const rows = await readDays(redis, 'cyber:r:', RECENT_DAYS + BASELINE_DAYS);
    const daysWithData = rows.filter(r => r.counts.t).length;
    const body = {
      configured: true,
      window: { recentDays: RECENT_DAYS, baselineDays: BASELINE_DAYS, daysWithData },
      daily: rows.map(r => ({ day: r.day, total: r.counts.t ?? 0 })),
      countries: trends(rows, 'c:'),
      sectors: trends(rows, 's:'),
      groups: trends(rows, 'g:'),
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...CORS, 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=300' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ configured: true, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: CORS },
    );
  }
}
