/**
 * Cyber incident grouping: several reports about one attack become one incident.
 *
 * "Five reports" and "five incidents" are different things. A ransomware group's leak-site claim, a
 * news article saying the company confirmed it, and a breach-catalog entry for the same company are
 * three REPORTS of ONE incident, and they carry different evidence: the claim is unverified, the
 * statement is the organization's own.
 *
 * Matching is deliberately conservative (a wrong merge hides a real incident; a missed merge only
 * shows two rows). Two reports are CANDIDATES when they name the same organization: the same website,
 * then the same normalized name (legal suffixes and punctuation removed), then a guarded whole-word
 * prefix ("Asahi" ~ "Asahi Group Holdings", but not "Bell" ~ "Bell Canada"). Candidates are merged
 * strongest first, in an order that does not depend on the input order, and a merge is refused unless
 * the WHOLE merged group still satisfies both rules:
 *   - it is placed in at most one country (a pairwise check is not enough: "Delta" in the US and
 *     "Delta" in Germany would otherwise join through a third report that names no country), and
 *   - everything in it OCCURRED within INCIDENT_WINDOW_MS of each other. The window limits the whole
 *     incident's span, not just neighbouring reports, so a chain of reports cannot stretch it forever.
 *     "Occurred" uses the known event date (a breach's own date) rather than when it was published.
 *
 * CISA KEV entries are never grouped: they describe a vulnerability known to be exploited, not an
 * attack on a particular organization or place.
 */
import type { EvidenceKind, Severity, VigilEvent } from '../types';
import { EVIDENCE_ORDER, isMappable } from '../types';
import { API_VERSION, filterEvents, mergeEvents, paginate } from './query';
import type { EventQuery } from './query';

/** An incident spans at most this long, measured over when its reports' events occurred. */
export const INCIDENT_WINDOW_MS = 21 * 24 * 3_600_000;

export interface IncidentReport {
  id: string;
  source: string;
  evidence: EvidenceKind | null;
  title: string;
  url: string;
  /** When the report was published or added. */
  timestamp: string;
  /** When the event itself happened, if the source says (a breach's own date). Grouping uses this. */
  occurredAt?: string;
}

/** What an incident row needs; also stamped on the representative event as `metadata.incident`. */
export interface IncidentSummary {
  id: string;
  org: string;
  reportCount: number;
  firstSeen: string;
  lastSeen: string;
  /** Distinct evidence kinds across the reports, strongest first. */
  evidence: EvidenceKind[];
  sources: string[];
  /** Ransomware group that claimed it, when a claim is among the reports. */
  claimedBy?: string;
  /** Ransomware groups, sectors and country codes across ALL reports (for filtering by what any report says). */
  groups: string[];
  sectors: string[];
  countryCodes: string[];
  reports: IncidentReport[];
}

export interface Incident extends IncidentSummary {
  orgKey: string;
  country: string;
  category: string;
  severity: Severity;
  /** The report that represents the incident on the map and in lists. */
  primaryId: string;
  /** The report with the best real location, when any report has one (it may differ from the primary). */
  placeId?: string;
  /** For pagination and ordering: the latest report time. */
  timestamp: string;
}

// ── Organization identity ──────────────────────────────────

const LEGAL = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'gmbh', 'plc', 'sa', 'ag',
  'nv', 'bv', 'srl', 'spa', 'pty', 'lp', 'llp', 'pllc', 'pc', 'group', 'holdings', 'holding', 'the', 'and',
]);

/** Words that mean a "name" is really a sentence from a leak-site post, not an organization. */
const NOT_A_NAME = /\b(ransomware|attack|breach|hacked|incident)\b/i;

/** Lowercase tokens of an organization name with punctuation, accents and legal suffixes removed. */
export function orgTokens(name: string): string[] {
  const all = name
    .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(?:[a-z]\.){2,}/g, m => m.replace(/\./g, '')) // "S.A." / "L.L.C." -> "sa" / "llc", so legal suffixes are recognised
    .replace(/\(.*?\)/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter(Boolean);
  const core = all.filter(t => !LEGAL.has(t));
  return core.length > 0 ? core : all;
}

export function orgKey(name: string): string {
  return orgTokens(name).join(' ');
}

/** A hostname without scheme, path or a leading "www.", or '' when there is none. */
export function hostOf(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const h = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : '';
}

interface Identity { name: string; tokens: string[]; key: string; host: string; country: string }

/** Who this report is about, or null when it names no usable organization. */
function identityOf(ev: VigilEvent): Identity | null {
  if (ev.domain !== 'cyber' || ev.category === 'vulnerability') return null;
  const m = ev.metadata ?? {};
  const name = [m.victim, m.impacted].find((v): v is string => typeof v === 'string' && v.trim().length > 0)?.trim();
  const host = hostOf(m.domain);
  if (!name || name.split(/\s+/).length > 8 || NOT_A_NAME.test(name)) return host ? { name: host, tokens: [], key: host, host, country: countryOf(ev) } : null;
  const tokens = orgTokens(name);
  if (tokens.join('').length < 3) return null;
  return { name, tokens, key: tokens.join(' '), host, country: countryOf(ev) };
}

function countryOf(ev: VigilEvent): string {
  const m = ev.metadata ?? {};
  const code = typeof m.countryCode === 'string' && m.countryCode ? m.countryCode : ev.location.country;
  return ev.location.precision === 'unknown' || !/^[A-Z]{2}$/.test(code ?? '') ? '' : code;
}

/**
 * How strongly two reports name the same organization: 3 same website, 2 same normalized name,
 * 1 guarded whole-word prefix, 0 not the same. Countries and time are checked per GROUP, not here.
 */
function matchStrength(a: Identity, b: Identity): number {
  if (a.host && a.host === b.host) return 3;
  if (a.key && a.key === b.key) return 2;
  const [short, long] = a.tokens.length <= b.tokens.length ? [a.tokens, b.tokens] : [b.tokens, a.tokens];
  if (short.length === 0 || short.length === long.length) return 0;
  // Whole-word prefix, and not a bare short word ("Bell" must not swallow "Bell Canada").
  const isPrefix = short.every((t, i) => t === long[i]);
  return isPrefix && (short.length >= 2 || short[0].length >= 6) ? 1 : 0;
}

/** When the event happened, if the report says (HIBP gives the breach's own date), else when it was published. */
export function occurredAt(ev: VigilEvent): number {
  const own = ev.metadata?.breachDate;
  const t = typeof own === 'string' ? Date.parse(own) : NaN;
  return Number.isFinite(t) ? t : new Date(ev.timestamp).getTime();
}

// ── Grouping ───────────────────────────────────────────────

const RANK: Record<EvidenceKind, number> = Object.fromEntries(EVIDENCE_ORDER.map((k, i) => [k, EVIDENCE_ORDER.length - i])) as Record<EvidenceKind, number>;
const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
/** Most specific category wins for the incident as a whole. */
const CATEGORY_ORDER = ['ransomware', 'supply-chain', 'espionage', 'malware', 'data-breach', 'ddos', 'phishing', 'cyberattack'];

const PRECISION_RANK = { exact: 3, area: 2, country: 1, unknown: 0 } as const;
const placeRank = (e: VigilEvent) => (isMappable(e) ? PRECISION_RANK[e.location.precision ?? 'country'] : 0);

const rank = (e: VigilEvent) => (e.evidence ? RANK[e.evidence] : 0);
const time = (e: { timestamp: string }) => new Date(e.timestamp).getTime();

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export interface Grouping {
  /** Every incident, including ones with a single report. */
  incidents: Incident[];
  /** Events that belong to no incident (KEV, other domains, reports naming no organization). */
  ungrouped: VigilEvent[];
}

export function groupIncidents(events: VigilEvent[]): Grouping {
  const items = events.map(ev => ({ ev, id: identityOf(ev) }));
  const eligible = items.filter((i): i is { ev: VigilEvent; id: Identity } => i.id !== null);
  const ungrouped = items.filter(i => i.id === null).map(i => i.ev);

  // Candidate pairs, strongest first and otherwise in a fixed order (closest in time, then by event id),
  // so the result is the same however the input happens to be ordered.
  const edges: Array<{ i: number; j: number; strength: number; gap: number }> = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const strength = matchStrength(eligible[i].id, eligible[j].id);
      if (strength > 0) edges.push({ i, j, strength, gap: Math.abs(occurredAt(eligible[i].ev) - occurredAt(eligible[j].ev)) });
    }
  }
  // Each edge's two ids in canonical (sorted) order, compared pair-wise. Concatenating them in input order
  // would make ties between equal-strength, equal-time candidates depend on how the input was ordered.
  const pair = (e: { i: number; j: number }): [string, string] => {
    const a = eligible[e.i].ev.id, b = eligible[e.j].ev.id;
    return a < b ? [a, b] : [b, a];
  };
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  edges.sort((a, b) => {
    const [a1, a2] = pair(a), [b1, b2] = pair(b);
    return b.strength - a.strength || a.gap - b.gap || cmp(a1, b1) || cmp(a2, b2);
  });

  // Merge only while the WHOLE merged group stays in one country and within the window.
  const parent = eligible.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const group = eligible.map((m, i) => ({ countries: new Set(m.id.country ? [m.id.country] : []), min: occurredAt(m.ev), max: occurredAt(m.ev), root: i }));
  for (const e of edges) {
    const ra = find(e.i), rb = find(e.j);
    if (ra === rb) continue;
    const a = group[ra], b = group[rb];
    if (new Set([...a.countries, ...b.countries]).size > 1) continue;                   // would span two countries
    if (Math.max(a.max, b.max) - Math.min(a.min, b.min) > INCIDENT_WINDOW_MS) continue;  // would span too long
    parent[ra] = rb;
    b.countries = new Set([...a.countries, ...b.countries]);
    b.min = Math.min(a.min, b.min); b.max = Math.max(a.max, b.max);
  }
  const clusters = new Map<number, typeof eligible>();
  eligible.forEach((m, i) => { const r = find(i); clusters.set(r, [...(clusters.get(r) ?? []), m]); });

  const incidents = [...clusters.values()].map(members => {
    const byTime = [...members].sort((a, b) => time(a.ev) - time(b.ev) || (a.ev.id < b.ev.id ? -1 : 1));
    const primary = [...members].sort((a, b) => rank(b.ev) - rank(a.ev) || time(b.ev) - time(a.ev) || (a.ev.id < b.ev.id ? -1 : 1))[0];
    // The canonical name is chosen by a fixed rule, never by input order: a structured name (leak-site
    // victim, breach title) beats one guessed from a headline, then the shortest normalized name, then id.
    const structured = (m: typeof members[number]) => (m.ev.evidence === 'claim' || m.ev.evidence === 'catalog' ? 0 : 1);
    const named = [...members].sort((a, b) => structured(a) - structured(b) || a.id.key.length - b.id.key.length || (a.id.key < b.id.key ? -1 : a.id.key > b.id.key ? 1 : 0) || (a.ev.id < b.ev.id ? -1 : 1))[0];
    // The map position comes from whichever report has the best real location, not necessarily the primary.
    const place = [...members].filter(m => placeRank(m.ev) > 0).sort((a, b) => placeRank(b.ev) - placeRank(a.ev) || rank(b.ev) - rank(a.ev) || (a.ev.id < b.ev.id ? -1 : 1))[0];
    const evidence = EVIDENCE_ORDER.filter(k => members.some(m => m.ev.evidence === k));
    const claim = byTime.find(m => m.ev.evidence === 'claim')?.ev.metadata?.group;
    const categories = members.map(m => m.ev.category);
    const category = CATEGORY_ORDER.find(c => categories.includes(c)) ?? primary.ev.category;
    const severity = members.map(m => m.ev.severity).sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0];
    const country = [...new Set(members.map(m => m.id.country).filter(Boolean))][0] ?? '';
    const last = byTime[byTime.length - 1].ev.timestamp;
    const distinct = (pick: (m: VigilEvent) => unknown) => [...new Set(members.map(m => pick(m.ev)).filter((v): v is string => typeof v === 'string' && v !== ''))].sort();
    return {
      // Stable as long as the earliest report is: an id built from the name would change whenever a
      // differently-spelled report joined. (Surviving the earliest report ageing out needs stored identity.)
      id: `incident-${hash(byTime[0].ev.id)}`,
      org: named.id.name, orgKey: named.id.key, country, category, severity,
      firstSeen: byTime[0].ev.timestamp, lastSeen: last, timestamp: last,
      reportCount: members.length, evidence,
      sources: [...new Set(byTime.map(m => m.ev.source))],
      ...(typeof claim === 'string' ? { claimedBy: claim } : {}),
      groups: distinct(e => e.metadata?.group), sectors: distinct(e => e.metadata?.sector),
      countryCodes: distinct(e => e.metadata?.countryCode ?? (e.location.precision === 'unknown' ? '' : e.location.country)),
      reports: byTime.map(m => {
        const occurred = occurredAt(m.ev);
        return {
          id: m.ev.id, source: m.ev.source, evidence: m.ev.evidence ?? null, title: m.ev.title, url: m.ev.sourceUrl, timestamp: m.ev.timestamp,
          ...(occurred !== time(m.ev) ? { occurredAt: new Date(occurred).toISOString() } : {}),
        };
      }),
      primaryId: primary.ev.id,
      ...(place ? { placeId: place.ev.id } : {}),
    } satisfies Incident;
  });

  incidents.sort((a, b) => time(b) - time(a) || (a.id < b.id ? -1 : 1));
  return { incidents, ungrouped };
}

// ── Collapsing for display ─────────────────────────────────

export function summaryOf(i: Incident): IncidentSummary {
  const { id, org, reportCount, firstSeen, lastSeen, evidence, sources, claimedBy, groups, sectors, countryCodes, reports } = i;
  return { id, org, reportCount, firstSeen, lastSeen, evidence, sources, ...(claimedBy ? { claimedBy } : {}), groups, sectors, countryCodes, reports };
}

export interface Collapsed {
  /** Events to show: each multi-report incident appears once, as its representative report. */
  events: VigilEvent[];
  /** Every collapsed report id → the id of the report that represents it (for counts and selection). */
  memberToPrimary: Map<string, string>;
}

/**
 * Replace each multi-report incident's reports with one representative event (the strongest-evidence
 * report), stamped with `incidentId`, the incident's highest severity and `metadata.incident`.
 * Single-report incidents and everything else pass through untouched, in their original order.
 */
export function collapseIncidents(events: VigilEvent[]): Collapsed {
  const { incidents } = groupIncidents(events);
  const multi = incidents.filter(i => i.reportCount > 1);
  const memberToPrimary = new Map<string, string>();
  const stamp = new Map<string, VigilEvent>();
  const hidden = new Set<string>();
  const byId = new Map(events.map(e => [e.id, e]));
  for (const inc of multi) {
    const primary = byId.get(inc.primaryId)!;
    // If the strongest report has no place but another report does, the incident takes that place:
    // otherwise an incident with a located claim would vanish from the map behind an unlocated article.
    const placed = inc.placeId && inc.placeId !== primary.id && !isMappable(primary) ? byId.get(inc.placeId) : undefined;
    const { unlocated: _drop, ...meta } = primary.metadata ?? {};
    void _drop;
    stamp.set(primary.id, {
      ...primary, severity: inc.severity, category: inc.category, incidentId: inc.id,
      ...(placed ? { location: placed.location } : {}),
      metadata: { ...(placed ? meta : primary.metadata), incident: summaryOf(inc) },
    });
    for (const r of inc.reports) {
      memberToPrimary.set(r.id, inc.primaryId);
      if (r.id !== inc.primaryId) hidden.add(r.id);
    }
  }
  return { events: events.filter(e => !hidden.has(e.id)).map(e => stamp.get(e.id) ?? e), memberToPrimary };
}

// ── API response ───────────────────────────────────────────

export interface IncidentsResponse {
  ok: boolean;
  version: string;
  generated: string;
  count: number;
  /** Incidents matching the filters, before pagination. */
  total: number;
  /** Individual reports behind those incidents. */
  total_reports: number;
  next_cursor: string | null;
  next_expiry: string | null;
  summary: {
    incidents: number;
    /**
     * Incidents backed by more than one report. This is NOT independent corroboration: two outlets
     * repeating one attacker claim, or two articles from one outlet, count as multiple reports. It
     * becomes "corroborated" only once report independence is established.
     */
    multi_report: number;
    /** How many incidents include each kind of evidence. */
    by_evidence: Partial<Record<EvidenceKind, number>>;
    by_category: Record<string, number>;
  };
  sources: import('./engine').SourceStatus[];
  data: Incident[];
}

/**
 * Group the cyber reports matching the filters into incidents. Filters apply to REPORTS before
 * grouping (so `severity=high` keeps an incident only through its high-severity reports), then
 * `minReports` and pagination apply to the incidents.
 */
export function buildIncidentsResponse(
  results: Array<{ events: VigilEvent[]; status: import('./engine').SourceStatus }>,
  q: EventQuery,
  minReports: number,
  now: number = Date.now(),
): IncidentsResponse {
  const reports = filterEvents(mergeEvents(results), { ...q, domains: ['cyber'], cursor: undefined }, now);
  const all = groupIncidents(reports).incidents.filter(i => i.reportCount >= minReports);
  const { page, nextCursor } = paginate(all, q);
  const by_evidence: IncidentsResponse['summary']['by_evidence'] = {};
  const by_category: Record<string, number> = {};
  for (const i of all) {
    for (const k of i.evidence) by_evidence[k] = (by_evidence[k] ?? 0) + 1;
    by_category[i.category] = (by_category[i.category] ?? 0) + 1;
  }
  return {
    ok: results.length === 0 || results.some(r => r.status.status !== 'error' || r.status.retained),
    version: API_VERSION, generated: new Date(now).toISOString(),
    count: page.length, total: all.length, total_reports: all.reduce((n, i) => n + i.reportCount, 0),
    next_cursor: nextCursor, next_expiry: null,
    summary: { incidents: all.length, multi_report: all.filter(i => i.reportCount > 1).length, by_evidence, by_category },
    sources: results.map(r => r.status),
    data: page,
  };
}
