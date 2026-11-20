/**
 * Data-breach proxy — Vercel Edge Function.
 *
 * Have I Been Pwned's public breach catalogue (no key needed for this list endpoint). It is ~1 MB
 * for ~1,000 breaches, so we keep only those ADDED in the last 90 days and trim the fields.
 *
 * Data: © Troy Hunt / Have I Been Pwned, CC BY 4.0 (attribution is shown on each event).
 * Failures return a real 5xx so the Data Health panel reports "Down", not "No data".
 */
export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const URL_ = 'https://haveibeenpwned.com/api/v3/breaches';
const WINDOW_DAYS = 90;
const KEEP = 40;

interface HibpBreach {
  Name: string;
  Title: string;
  Domain?: string;
  BreachDate?: string;
  AddedDate: string;
  PwnCount?: number;
  DataClasses?: string[];
  Description?: string;
  IsVerified?: boolean;
  IsSensitive?: boolean;
}

const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    const res = await fetch(URL_, {
      headers: { 'User-Agent': 'VigilMap/1.0 (https://github.com/littleworks-inc/vgilmap)', Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return fail(`HIBP HTTP ${res.status}`);
    const all = (await res.json()) as HibpBreach[];
    if (!Array.isArray(all)) return fail('HIBP returned an unexpected response');

    const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
    const breaches = all
      .filter(b => new Date(b.AddedDate).getTime() >= cutoff)
      .sort((a, b) => b.AddedDate.localeCompare(a.AddedDate))
      .slice(0, KEEP)
      .map(b => ({
        name: b.Name,
        title: b.Title,
        domain: b.Domain ?? '',
        breachDate: b.BreachDate ?? '',
        addedDate: b.AddedDate,
        pwnCount: b.PwnCount ?? 0,
        dataClasses: b.DataClasses ?? [],
        description: plain(b.Description ?? '').slice(0, 300),
        verified: !!b.IsVerified,
        sensitive: !!b.IsSensitive,
      }));

    return new Response(JSON.stringify({ breaches }), {
      status: 200,
      headers: { ...CORS, 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function fail(message: string): Response {
  return new Response(JSON.stringify({ breaches: [], error: message }), { status: 502, headers: { ...CORS, 'Cache-Control': 'no-store' } });
}
