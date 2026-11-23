/**
 * The Today briefing and the incident page's content, built from the events already loaded.
 * Pure functions: no React, no clock, no storage (those are passed in), so the rules are testable.
 *
 * Honest limits, by design:
 *  - "What changed" compares with a local snapshot of the last visit (see seen.ts), not stored history.
 *  - Facts about an incident come from the reports we hold, each with its own evidence; anything no
 *    report supports is listed as NOT ESTABLISHED rather than guessed.
 */
import type { Domain, EvidenceKind, Severity, VigilEvent } from '../types';
import { EVIDENCE_ORDER, isExpired, isMappable } from '../types';
import { groupIncidents } from '../../shared/pipeline/incidents';
import type { Incident } from '../../shared/pipeline/incidents';
import { countryName } from '../../shared/adapters/countries';
import { PRECISION_META } from '../../shared/pipeline/precision';
import { ago } from '../../shared/pipeline/health';
import type { SeenItem, SeenSnapshot } from './seen';

// ── Wording ────────────────────────────────────────────────

const PHRASE: Record<EvidenceKind, [string, string]> = {
  confirmed: ['organization statement', 'organization statements'],
  catalog:   ['breach-catalog entry', 'breach-catalog entries'],
  report:    ['news report', 'news reports'],
  claim:     ['attacker claim', 'attacker claims'],
  official:  ['official advisory', 'official advisories'],
};

/** "1 organization statement · 2 news reports", strongest evidence first. */
export function evidenceSummary(reports: Array<{ evidence: EvidenceKind | null }>): string {
  const parts = EVIDENCE_ORDER.flatMap(k => {
    const n = reports.filter(r => r.evidence === k).length;
    return n > 0 ? [`${n} ${PHRASE[k][n === 1 ? 0 : 1]}`] : [];
  });
  const unlabelled = reports.filter(r => r.evidence === null).length;
  if (unlabelled > 0) parts.push(`${unlabelled} other report${unlabelled === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

const NOUN: Record<string, string> = {
  ransomware: 'ransomware attack', 'data-breach': 'data breach', ddos: 'DDoS attack', 'supply-chain': 'supply-chain attack',
  espionage: 'espionage campaign', malware: 'malware incident', phishing: 'phishing campaign', cyberattack: 'cyber incident',
};

/** A headline that says no more than the evidence does: "claimed" is not "confirmed". */
export function incidentHeadline(i: Incident): string {
  const noun = NOUN[i.category] ?? 'cyber incident';
  const stance =
    i.evidence.includes('confirmed') ? 'confirmed by the organization'
    : i.evidence.includes('catalog') ? 'listed in a breach catalog'
    : i.evidence.includes('report') ? 'reported'
    : `claimed${i.claimedBy ? ` by ${i.claimedBy}` : ' by attackers'}`;
  return `${i.org}: ${noun} ${stance}`;
}

// ── Cards ──────────────────────────────────────────────────

export type ChangeKind = 'first-visit' | 'new' | 'more-reports' | 'unchanged';
export interface Change { kind: ChangeKind; text: string }

export interface BriefCard {
  id: string;
  kind: 'incident' | 'event';
  domain: Domain;
  severity: Severity;
  headline: string;
  place: string;
  /** Latest report time. */
  published: string;
  /** When it happened, only when a source says and it differs from publication. */
  occurred?: string;
  change: Change;
  evidenceSummary: string;
  /** e.g. "Active until 18:00" for an alert. */
  note?: string;
  event: VigilEvent;
  incident?: Incident;
  /** Ids of every event this card stands for (more than one when identical alerts were merged). */
  memberIds: string[];
  score: number;
}

export interface Briefing {
  /** Cards whose report count or existence changed since the last visit (empty on a first visit). */
  sinceLast: BriefCard[];
  /** The most significant developments that have not changed since the last visit. */
  major: BriefCard[];
  /** Everything on screen, for saving the next snapshot. */
  snapshot: Record<string, SeenItem>;
  lastVisitAt?: number;
}

const SEVERITY_POINTS: Record<Severity, number> = { critical: 40, high: 30, medium: 15, low: 5, info: 0 };
const MAJOR_LIMIT = 9;
const PER_DOMAIN_LIMIT = 3;
const SINCE_LIMIT = 12;
const CLAIM_ONLY_PENALTY = 15;

function placeOfEvent(ev: VigilEvent): string {
  if (!isMappable(ev)) return 'No map location';
  const p = ev.location.precision;
  return p === 'country' || p === 'area' ? `${ev.location.label} · ${PRECISION_META[p].label.toLowerCase()}` : ev.location.label;
}

function placeOfIncident(i: Incident): string {
  const code = i.countryCodes[0] ?? i.country;
  return code ? `${countryName(code)} · country estimate` : 'Location not stated';
}

function changeFor(id: string, n: number, evidence: EvidenceKind[], published: string, seen: SeenSnapshot | null, now: number): Change {
  if (!seen) return { kind: 'first-visit', text: `First reported ${ago(now - Date.parse(published))}` };
  const prev = seen.items[id];
  if (!prev) {
    // A cut snapshot may just not have had room for it: only call it new if it appeared after that visit.
    if (seen.partial && Date.parse(published) <= seen.at) return { kind: 'unchanged', text: 'No change since your last visit' };
    return { kind: 'new', text: 'New since your last visit' };
  }
  if (n > prev.n) {
    const added = evidence.filter(k => !prev.evidence.includes(k));
    const extra = n - prev.n;
    return { kind: 'more-reports', text: `+${extra} report${extra === 1 ? '' : 's'} since your last visit${added.length ? `: ${added.map(k => PHRASE[k][0]).join(', ')} added` : ''}` };
  }
  return { kind: 'unchanged', text: 'No change since your last visit' };
}

function recency(iso: string, now: number): number {
  const h = (now - Date.parse(iso)) / 3_600_000;
  return h <= 24 ? 10 : h <= 72 ? 5 : 0;
}

/** Build the Today briefing from the live (non-expired, in-window) events. */
export function buildBriefing({ events, seen, now }: { events: VigilEvent[]; seen: SeenSnapshot | null; now: number }): Briefing {
  const live = events.filter(e => !isExpired(e, now));
  const { incidents, ungrouped } = groupIncidents(live);
  const cards: BriefCard[] = [];

  for (const i of incidents) {
    const event = live.find(e => e.id === i.primaryId)!;
    const occurred = i.reports.map(r => r.occurredAt).filter((v): v is string => !!v).sort()[0];
    cards.push({
      id: i.id, kind: 'incident', domain: 'cyber', severity: i.severity, headline: incidentHeadline(i), place: placeOfIncident(i),
      published: i.lastSeen, ...(occurred ? { occurred } : {}),
      change: changeFor(i.id, i.reportCount, i.evidence, i.lastSeen, seen, now),
      evidenceSummary: evidenceSummary(i.reports), event, incident: i, memberIds: [i.id],
      // An incident that rests ONLY on an attacker's own claim is unverified, so it ranks below measured or
      // reported events of the same severity: a leak-site listing should not lead the briefing by itself.
      score: SEVERITY_POINTS[i.severity] + recency(i.lastSeen, now) + Math.min(10, (i.reportCount - 1) * 5) + (i.evidence.includes('confirmed') ? 5 : 0)
        - (i.evidence.every(k => k === 'claim') ? CLAIM_ONLY_PENALTY : 0),
    });
  }
  // The same alert is often published once per zone (NOAA issues one id per area, with an identical
  // title). One card per distinct warning, not one per zone: a copy-for-copy repeat adds no information.
  const sameWarning = new Map<string, VigilEvent[]>();
  for (const e of ungrouped) {
    if (e.category === 'vulnerability') continue; // an exploited vulnerability is not an incident at a place
    const key = `${e.source}|${e.domain}|${e.title}`;
    const list = sameWarning.get(key);
    if (list) list.push(e); else sameWarning.set(key, [e]);
  }
  for (const members of sameWarning.values()) {
    // Prefer a copy the visitor has already seen (so a merged card is not "new" again), then one with a place.
    const e = [...members].sort((a, b) =>
      Number(!!seen?.items[b.id]) - Number(!!seen?.items[a.id]) || Number(isMappable(b)) - Number(isMappable(a)) || (a.id < b.id ? -1 : 1))[0];
    const others = members.length - 1;
    const expiry = e.expiresAt ? `Active until ${new Date(e.expiresAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : '';
    const note = [expiry, others > 0 ? `Also issued for ${others} other area${others === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
    cards.push({
      id: e.id, kind: 'event', domain: e.domain, severity: e.severity, headline: e.title, place: placeOfEvent(e), published: e.timestamp,
      change: changeFor(e.id, 1, [], e.timestamp, seen, now),
      evidenceSummary: e.evidence ? evidenceSummary([{ evidence: e.evidence }]) : e.source,
      ...(note ? { note } : {}),
      event: e, memberIds: members.map(m => m.id), score: SEVERITY_POINTS[e.severity] + recency(e.timestamp, now),
    });
  }

  const byScore = (a: BriefCard, b: BriefCard) => b.score - a.score || Date.parse(b.published) - Date.parse(a.published) || (a.id < b.id ? -1 : 1);
  const changed = cards.filter(c => c.change.kind === 'new' || c.change.kind === 'more-reports').sort(byScore);
  // Not everything new is worth a card: new LOW-severity items would drown the briefing, so they only
  // appear if they add reports to something already seen (that is a real update).
  const sinceLast = changed.filter(c => c.change.kind === 'more-reports' || c.severity !== 'low' && c.severity !== 'info').slice(0, SINCE_LIMIT);

  const taken = new Set(sinceLast.map(c => c.id));
  const perDomain = new Map<Domain, number>();
  const major: BriefCard[] = [];
  for (const c of cards.filter(c => !taken.has(c.id)).sort(byScore)) {
    if (major.length >= MAJOR_LIMIT) break;
    if ((perDomain.get(c.domain) ?? 0) >= PER_DOMAIN_LIMIT) continue; // a mix of domains, not nine earthquakes
    if (c.severity === 'low' || c.severity === 'info') continue;
    perDomain.set(c.domain, (perDomain.get(c.domain) ?? 0) + 1);
    major.push(c);
  }

  // Most important first, so that if the snapshot has to be cut it drops what could never lead the briefing.
  const snapshot: Record<string, SeenItem> = {};
  for (const c of [...cards].sort(byScore)) {
    for (const id of c.memberIds) snapshot[id] = { n: c.incident?.reportCount ?? 1, evidence: c.incident?.evidence ?? [] };
  }
  return { sinceLast, major, snapshot, ...(seen ? { lastVisitAt: seen.at } : {}) };
}

// ── Incident page ──────────────────────────────────────────

export interface FactSupport { evidence: EvidenceKind | null; source: string; url: string; title: string; timestamp: string }
export interface Fact {
  id: string;
  question: string;
  /** What we can say, with its limits stated. For an unestablished fact: "Not established." */
  answer: string;
  established: boolean;
  support: FactSupport[];
}

/** What the facts are drawn from: an incident's reports, or a single event that belongs to no incident. */
export type FactsInput = Pick<Incident, 'reports' | 'firstSeen' | 'claimedBy'>;

/**
 * A cyber event that names no usable organization (a long leak-site victim description, a news item about
 * a campaign) is in no incident, but the same questions still apply to it, and "Not established" is the
 * honest answer to most of them. Vulnerabilities are not incidents at a place, so they are left out.
 */
export function factsInputOf(ev: VigilEvent): FactsInput | null {
  if (ev.domain !== 'cyber' || ev.category === 'vulnerability') return null;
  const group = ev.evidence === 'claim' ? ev.metadata?.group : undefined;
  return {
    firstSeen: ev.timestamp, ...(typeof group === 'string' && group ? { claimedBy: group } : {}),
    reports: [{ id: ev.id, source: ev.source, evidence: ev.evidence ?? null, category: ev.category, title: ev.title, url: ev.sourceUrl, timestamp: ev.timestamp }],
  };
}

const DISRUPTION = /\b(outage|disrupt\w*|offline|down|unavailable|restor\w*|halt\w*|shut\s?down|suspend\w*)\b/i;
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)} million` : n >= 1_000 ? `${Math.round(n / 1_000)} thousand` : String(n));

/**
 * What the reports we hold establish about an incident, fact by fact. Each fact has its OWN evidence:
 * one incident can have an organization-confirmed intrusion and an unverified theft claim at once.
 * Questions no report answers come back with `established: false`.
 */
export function incidentFacts(incident: FactsInput, eventsById: ReadonlyMap<string, VigilEvent>): Fact[] {
  const { reports } = incident;
  const of = (k: EvidenceKind) => reports.filter(r => r.evidence === k);
  const sup = (rs: typeof reports): FactSupport[] => rs.map(r => ({ evidence: r.evidence, source: r.source, url: r.url, title: r.title, timestamp: r.timestamp }));
  const meta = (id: string) => eventsById.get(id)?.metadata ?? {};
  const group = incident.claimedBy ?? 'an attacker group';
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

  const confirmed = of('confirmed'), catalog = of('catalog'), news = of('report'), claims = of('claim');
  const facts: Fact[] = [];

  // 1. Did it happen, and who says so?
  if (confirmed.length) facts.push({ id: 'happened', question: 'Did it happen?', answer: 'The organization itself has said so.', established: true, support: sup(confirmed) });
  else if (catalog.length) facts.push({ id: 'happened', question: 'Did it happen?', answer: 'Listed in an independent breach catalog (Have I Been Pwned). The organization has not been shown to confirm it.', established: true, support: sup(catalog) });
  else if (news.length) facts.push({ id: 'happened', question: 'Did it happen?', answer: 'Reported by news outlets. The organization has not confirmed it.', established: true, support: sup(news) });
  else if (claims.length) facts.push({ id: 'happened', question: 'Did it happen?', answer: `Claimed by ${group} on a leak site. Unverified: attackers sometimes make false claims.`, established: true, support: sup(claims) });

  // 2. Who claims responsibility?
  facts.push(claims.length
    ? { id: 'actor', question: 'Who claims responsibility?', answer: `${group} listed the organization on its leak site. This is a claim, not a finding.`, established: true, support: sup(claims) }
    : { id: 'actor', question: 'Who claims responsibility?', answer: 'Not established. No attacker claim found.', established: false, support: [] });

  // 3. Was data taken?
  const withCount = catalog.find(r => typeof meta(r.id).pwnCount === 'number');
  if (withCount) {
    const classes = Array.isArray(meta(withCount.id).dataClasses) ? (meta(withCount.id).dataClasses as string[]).slice(0, 4).join(', ') : '';
    facts.push({ id: 'data', question: 'Was data taken?', answer: `The breach catalog lists ${compact(meta(withCount.id).pwnCount as number)} accounts exposed${classes ? ` (${classes})` : ''}.`, established: true, support: sup([withCount]) });
  } else if (claims.length) {
    facts.push({ id: 'data', question: 'Was data taken?', answer: `${group} claims to hold the organization's data. Not verified.`, established: true, support: sup(claims) });
  } else {
    facts.push({ id: 'data', question: 'Was data taken?', answer: 'Not established.', established: false, support: [] });
  }

  // 4. Are services affected?
  const disrupted = reports.filter(r => DISRUPTION.test(r.title));
  facts.push(disrupted.length
    ? { id: 'services', question: 'Are services affected?', answer: `A report describes disruption: “${disrupted[0].title}”. No status notice from the organization is among our sources.`, established: true, support: sup(disrupted) }
    : { id: 'services', question: 'Are services affected?', answer: 'Not established.', established: false, support: [] });

  // 5. How many people or records?
  facts.push(withCount
    ? { id: 'scale', question: 'How many people are affected?', answer: `${(meta(withCount.id).pwnCount as number).toLocaleString()} accounts, per the breach catalog. This counts exposed accounts, which may not be the same as affected people.`, established: true, support: sup([withCount]) }
    : { id: 'scale', question: 'How many people are affected?', answer: 'Not established. No supporting figure available.', established: false, support: [] });

  // 6. When did it happen?
  const occurred = reports.filter(r => r.occurredAt);
  if (occurred.length) facts.push({ id: 'when', question: 'When did it happen?', answer: `${day(occurred[0].occurredAt!)}, per ${occurred[0].source}. First reported ${day(incident.firstSeen)}.`, established: true, support: sup([occurred[0]]) });
  else if (claims.length) facts.push({ id: 'when', question: 'When did it happen?', answer: `${group} dates it ${day(claims[0].timestamp)}. Unverified.`, established: true, support: sup([claims[0]]) });
  else facts.push({ id: 'when', question: 'When did it happen?', answer: `Not established. First reported ${day(incident.firstSeen)}.`, established: false, support: [] });

  return facts;
}

/** One sentence of "current understanding", from the strongest evidence we hold. */
export function understanding(incident: Incident): string {
  const n = incident.reportCount;
  const lead = incident.evidence.includes('confirmed') ? 'The organization has confirmed this.'
    : incident.evidence.includes('catalog') ? 'An independent breach catalog lists it.'
    : incident.evidence.includes('report') ? 'News outlets report this; the organization has not confirmed it.'
    : `Only the attackers say this happened${incident.claimedBy ? ` (${incident.claimedBy})` : ''}, and it is unverified.`;
  const claim = incident.evidence.includes('claim') && !(incident.evidence.length === 1)
    ? ` An attacker group${incident.claimedBy ? ` (${incident.claimedBy})` : ''} also claims it.` : '';
  return `${lead}${claim} Based on ${n} report${n === 1 ? '' : 's'} from ${incident.sources.length} source${incident.sources.length === 1 ? '' : 's'}.`;
}

/** What is different about an incident since the last visit, in words; null if it was not tracked then. */
export function incidentChange(incident: Incident, seen: SeenSnapshot | null, now: number): Change {
  return changeFor(incident.id, incident.reportCount, incident.evidence, incident.lastSeen, seen, now);
}
