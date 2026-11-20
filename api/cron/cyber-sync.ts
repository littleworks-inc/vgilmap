/**
 * Daily cyber sync — Vercel Cron (see vercel.json).
 * Rebuilds the current month's daily aggregates from ransomware.live and the
 * recent CISA KEV additions. On the 1st of the month it rebuilds the PREVIOUS
 * month instead, so that month gets a final complete pass (the current month's
 * first day is picked up on the 2nd).
 *
 * Requires CRON_SECRET: Vercel sends it as `Authorization: Bearer <secret>`.
 */
export const config = { runtime: 'edge' };

import {
  getRedis,
  fetchVictimMonth,
  fetchKevAll,
  writeVictimDays,
  writeKevDays,
  markSynced,
} from '../_lib/cyber-store';

const KEV_WINDOW_DAYS = 45;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'CRON_SECRET not configured' }, 500);
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  try {
    const redis = getRedis();
    const now = new Date();
    // On day 1, finalize last month.
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (now.getUTCDate() === 1 ? 1 : 0), 1));
    const year = target.getUTCFullYear();
    const month = target.getUTCMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;

    const victims = await fetchVictimMonth(year, month);
    const victimDays = await writeVictimDays(redis, victims, key);

    const cutoff = new Date(now.getTime() - KEV_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const kev = (await fetchKevAll()).filter(v => (v.dateAdded ?? '') >= cutoff);
    const kevDays = await writeKevDays(redis, kev);

    await markSynced(redis, { lastMonth: key });
    return json({ ok: true, month: key, claims: victims.length, victimDays, kevDays });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
