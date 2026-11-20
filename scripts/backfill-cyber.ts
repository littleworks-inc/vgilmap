/**
 * One-off historical backfill of cyber aggregates into Redis.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-cyber.ts [--months=24]
 *
 * ransomware.live's archive allows 1 request/minute, so this takes ~1 minute per
 * month (24 months ≈ 25 min). It is safe to stop and re-run: days are overwritten,
 * never incremented, and months already completed are skipped. The two most recent
 * months are always refetched because they are still changing.
 */
import {
  getRedis,
  fetchVictimMonth,
  fetchKevAll,
  writeVictimDays,
  writeKevDays,
  markSynced,
  RateLimitedError,
} from '../api/_lib/cyber-store';

const WAIT_MS = 62_000; // 1 req/min limit + margin

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function monthsBack(n: number): Array<{ year: number; month: number; key: string }> {
  const out: Array<{ year: number; month: number; key: string }> = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    out.push({ year, month, key: `${year}-${String(month).padStart(2, '0')}` });
  }
  return out;
}

async function main() {
  const arg = process.argv.find(a => a.startsWith('--months='));
  const months = Math.max(1, Math.min(60, Number(arg?.split('=')[1] ?? 24) || 24));
  const redis = getRedis();

  // 1) KEV: one request returns the entire catalog.
  console.log('Fetching CISA KEV catalog…');
  const kevDays = await writeKevDays(redis, await fetchKevAll());
  console.log(`  wrote ${kevDays} KEV days`);

  // 2) Ransomware victims, one month at a time, oldest first.
  const meta = (await redis.hgetall<Record<string, string>>('cyber:meta')) ?? {};
  const plan = monthsBack(months);
  let first = true;

  for (let i = 0; i < plan.length; i++) {
    const { year, month, key } = plan[i];
    const recent = i >= plan.length - 2;
    if (!recent && meta[`done:${key}`]) {
      console.log(`${key}: already done, skipping`);
      continue;
    }
    if (!first) await sleep(WAIT_MS);
    first = false;

    let list: unknown[] | undefined;
    for (let attempt = 1; attempt <= 4 && !list; attempt++) {
      try {
        list = await fetchVictimMonth(year, month);
      } catch (err) {
        if (err instanceof RateLimitedError && attempt < 4) {
          console.log(`${key}: rate limited, waiting…`);
          await sleep(WAIT_MS);
        } else {
          throw err;
        }
      }
    }

    const days = await writeVictimDays(redis, list, key);
    await markSynced(redis, { [`done:${key}`]: new Date().toISOString() });
    console.log(`${key}: ${list!.length} claims → ${days} days written`);
  }
  console.log('Backfill complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
