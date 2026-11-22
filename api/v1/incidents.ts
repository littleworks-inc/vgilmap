/**
 * VigilMap Public REST API — /api/v1/incidents
 *
 * Cyber reports grouped into incidents: a ransomware group's claim, a news article, the company's
 * own statement and a breach-catalog entry about the same organization are several REPORTS of one
 * INCIDENT, each with its own evidence label (attacker claim / news report / org-confirmed / catalog).
 * CISA KEV vulnerabilities are not attacks on an organization and are never grouped; they stay in
 * /api/v1/events (domain=cyber, category=vulnerability).
 *
 * GET /api/v1/incidents
 *   ?min_reports=2                  (keep only incidents backed by that many reports)
 *   ?severity= ?since= ?location= ?lifecycle=   (applied to the reports before grouping)
 *   ?source=cyber,cyber-news,cyber-breaches     (default: all three cyber sources)
 *   ?limit=100&cursor=...           (incidents, newest report first; pass next_cursor for the next page)
 *
 * Grouping is deliberately conservative: the same website, or the same normalized organization name,
 * where the WHOLE group stays in one country and everything occurred within 21 days of each other
 * (the window limits the incident's total span). See shared/pipeline/incidents.ts.
 */
import { CORS, errorResponse, runIncidents, toResponse } from '../_lib/pipeline';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    return toResponse(await runIncidents(new URL(req.url).searchParams));
  } catch (err) {
    return errorResponse(err);
  }
}
