/**
 * Cyber incident news proxy — Vercel Edge Function.
 * Headlines from security news outlets; the browser adapter classifies them (breach, malware, DDoS,
 * phishing, supply chain, espionage, exploited vulnerability) and drops everything else.
 * Reports per-feed status; returns 502 only if every feed failed.
 */
import { fetchFeeds } from './_lib/rss';

export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

const FEEDS = [
  { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/' },
  { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews' },
  { name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/' },
  { name: 'The Record', url: 'https://therecord.media/feed' },
  { name: 'SecurityWeek', url: 'https://www.securityweek.com/feed/' },
  { name: 'Dark Reading', url: 'https://www.darkreading.com/rss.xml' },
  { name: 'CyberScoop', url: 'https://cyberscoop.com/feed/' },
];

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { items, feeds } = await fetchFeeds(FEEDS, /./, 120); // no server filter: classification is in the adapter
  if (feeds.every(f => !f.ok)) {
    return new Response(JSON.stringify({ items: [], feeds, error: 'all cyber news feeds failed' }), {
      status: 502, headers: { ...CORS, 'Cache-Control': 'no-store' },
    });
  }
  return new Response(JSON.stringify({ items, feeds }), {
    status: 200,
    headers: { ...CORS, 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=600' },
  });
}
