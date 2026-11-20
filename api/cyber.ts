/**
 * Cyber Proxy — Vercel Edge Function
 * Proxies ransomware.live (recent ransomware victims) and CISA KEV
 * (Known Exploited Vulnerabilities) server-side to avoid CORS issues.
 * The KEV catalog is ~1 MB, so it is trimmed to the last 30 days here.
 */
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const KEV_WINDOW_DAYS = 30;

async function safeJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const [victims, kevRaw] = await Promise.all([
    safeJson('https://api.ransomware.live/v2/recentvictims'),
    safeJson('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'),
  ]);

  const cutoff = new Date(Date.now() - KEV_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const kevAll = (kevRaw as { vulnerabilities?: Array<{ dateAdded?: string }> } | null)?.vulnerabilities;
  const kev = Array.isArray(kevAll) ? kevAll.filter(v => (v.dateAdded ?? '') >= cutoff) : null;

  return new Response(JSON.stringify({ victims, kev }), {
    status: 200,
    headers: {
      ...CORS,
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=120',
    },
  });
}
