/**
 * Cyber incident news — headlines from security outlets (BleepingComputer, The Hacker News, Krebs,
 * The Record, SecurityWeek, Dark Reading, CyberScoop), via /api/cyber-news.
 *
 * Each headline is classified into an attack type; headlines that aren't about an attack (product
 * news, opinion, patch notes, weekly roundups) are dropped. The impacted organisation is a best-effort
 * guess from phrasing like "<Org> says/confirms/discloses…", and only for breach-type stories. Location is the first country named in the
 * headline; headlines naming none are `unlocated` (list only).
 */
import type { VigilEvent, Severity } from '../types';
import { addWarning } from './source-warnings';
import { countryName, findCountries } from './countries';

interface NewsItem { title: string; link: string; date: string; description: string; feed: string }

interface Kind { category: string; label: string; severity: Severity }

// Headlines that are not incidents: weekly roundups, newsletters, sponsored posts.
const NOT_AN_INCIDENT = /^(in other news|what we missed|week in review|weekly recap|this week in|feedback friday|newsletter|podcast|webinar|sponsored)\b/i;

// An attack that is actually happening, as opposed to a vulnerability being discussed or patched.
const EXPLOITED = /zero[- ]day|actively exploited|exploited in the wild|under (active )?attack|being exploited|(hackers?|attackers?|threat actors?)\s+exploit|exploit(s|ed|ing)?\b[^.]{0,60}\b(flaw|vulnerabilit|bug)/i;

// Patch / fix notes about a flaw are not attacks unless the headline says it is being exploited.
const PATCH_NOTE = /\b(patch(es|ed)?|fix(es|ed)?)\b/i;
const FLAW_WORDS = /flaws?|vulnerabilit|\bbugs?\b/i;

// First match wins, so order matters: most specific first, generic last.
const RULES: Array<[RegExp, Kind]> = [
  [/ransomware|extortion gang|leak site/i,                                          { category: 'ransomware',   label: 'Ransomware',               severity: 'high' }],
  [/\bddos\b|denial[- ]of[- ]service/i,                                             { category: 'ddos',         label: 'DDoS attack',              severity: 'medium' }],
  [/supply[- ]chain|malicious (npm|pypi|package|extension|library)|poisoned/i,      { category: 'supply-chain', label: 'Supply-chain attack',      severity: 'high' }],
  [/state[- ]sponsored|nation[- ]state|\bapt\d*\b|espionage|(china|russia|iran)[- ]linked|(chinese|russian|iranian|north korean) hackers|north korea|lazarus|hacktivis/i, { category: 'espionage', label: 'State-linked / espionage', severity: 'high' }],
  [EXPLOITED,                                                                        { category: 'vulnerability', label: 'Exploited vulnerability', severity: 'high' }],
  [/data breach|breached|\bbreach(es)?\b|data leak|leaked|stole[n]?\b|exposes?\b.*(data|customers|records)|exfiltrat|customer data|hackers? (steal|stole|claim)/i, { category: 'data-breach', label: 'Data breach', severity: 'high' }],
  [/malware|trojan|botnet|infostealer|info-stealer|stealer|backdoor|spyware|rootkit|\bworm\b|wiper|\bRAT\b|loader|cryptojack|clickfix/i, { category: 'malware', label: 'Malware', severity: 'medium' }],
  [/phishing|smishing|vishing|\bscams?\b|business email compromise|\bbec\b|credential theft/i, { category: 'phishing', label: 'Phishing / scam', severity: 'medium' }],
  [/(?:hackers?|attackers?|threat actors?)\b[^.,:;]{0,25}?\b(?:target|hit|attack|breach|compromis)|cyber[- ]?attack|cyber incident|security incident|hit by (a )?(cyber)?attack|network (disruption|intrusion)|systems? (outage|disruption)|intrusion/i, { category: 'cyberattack', label: 'Cyber incident', severity: 'medium' }],
];

function classify(title: string): Kind | null {
  if (NOT_AN_INCIDENT.test(title)) return null;
  if (PATCH_NOTE.test(title) && FLAW_WORDS.test(title) && !EXPLOITED.test(title)) return null;
  for (const [rx, kind] of RULES) if (rx.test(title)) return kind;
  return null;
}

/**
 * "Bell Canada says …", "Asahi confirms …": the organisation named before the verb. Best effort,
 * and only for categories where the subject of such a headline is normally the victim. (For
 * "Amazon says Chinese hackers used…" the subject is the reporter, so exploited-vulnerability,
 * malware and espionage stories get no guess.)
 */
const VICTIM_CATEGORIES = new Set(['data-breach', 'ransomware', 'cyberattack', 'ddos']);
function guessVictim(title: string, category: string): string | undefined {
  if (!VICTIM_CATEGORIES.has(category)) return undefined;
  const m = title.match(/^(.{2,60}?)\s+(?:says|confirms|confirmed|discloses|disclosed|warns|reveals|notifies|suffers|suffered|hit by|hacked|breached|restores|reports?)\b/i);
  const v = m?.[1]?.trim();
  return v && !/^(hackers?|attackers?|researchers?|new)$/i.test(v) && v.split(/\s+/).length <= 6 ? v : undefined;
}

/**
 * Phrases that name the ATTACKER ("China-linked hackers", "Iran-backed group", "Chinese APT"), not
 * where the incident happened. They are removed before looking for a place, otherwise
 * "China-Linked Hackers Exploit VMware Zero-Day" would be plotted in China.
 */
const ATTRIBUTION = new RegExp(
  [
    String.raw`\b(?:china|russia|iran|north korea|israel|belarus|vietnam|pakistan|india)[- ](?:linked|based|backed|nexus|aligned|sponsored|affiliated|origin)\b`,
    String.raw`\b(?:chinese|russian|iranian|north korean|israeli|belarusian|vietnamese|pakistani|indian)\s+(?:state[- ]sponsored\s+|state[- ]backed\s+)?(?:hackers?|apt\d*|threat actors?|cyber ?(?:criminals?|spies|actors?)|groups?|government|state|operatives?)\b`,
    String.raw`\b(?:from|by|in)\s+(?:china|russia|iran|north korea)\b(?=\s+(?:hackers?|apt|actors?|groups?))`,
    // possessive attribution: "Russia's Cold Relic APT", "China's Salt Typhoon hackers"
    String.raw`\b(?:china|russia|iran|north korea)['’]s\b(?=[^.]{0,40}\b(?:apt\d*|hackers?|groups?|actors?|operatives?|typhoon|bear|panda|kitten)\b)`,
    // the attacker described by where it sits: "hackers in China", "groups based in Russia"
    String.raw`\b(?:hackers?|attackers?|threat actors?|groups?|apt\d*)\s+(?:in|from|based in)\s+(?:china|russia|iran|north korea)\b`,
  ].join('|'),
  'gi',
);

/** The first country named in the headline once attacker attribution is removed. */
function victimCountry(title: string) {
  return findCountries(title.replace(ATTRIBUTION, ' '))[0];
}

function hashId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export async function fetchCyberNews(): Promise<VigilEvent[]> {
  const res = await fetch('/api/cyber-news');
  if (!res.ok) throw new Error(`cyber-news proxy ${res.status}`);
  const json = (await res.json()) as { items?: NewsItem[]; feeds?: Array<{ name: string; ok: boolean }> };

  const failed = (json.feeds ?? []).filter(f => !f.ok).map(f => f.name);
  if (failed.length > 0) addWarning('cyber-news', `${failed.join(', ')} feed unavailable`);

  const events: VigilEvent[] = [];
  const seen = new Set<string>();
  for (const item of json.items ?? []) {
    const kind = classify(item.title);
    if (!kind) continue;
    const id = `cyber-news-${hashId(item.link || item.title)}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const victim = guessVictim(item.title, kind.category);
    const country = victimCountry(item.title);
    events.push({
      id,
      timestamp: item.date,
      domain: 'cyber',
      category: kind.category,
      severity: kind.severity,
      title: item.title.slice(0, 150),
      description: item.description || kind.label,
      location: country
        ? { lat: country.coords[0], lng: country.coords[1], country: country.code, region: countryName(country.code), label: countryName(country.code) }
        : { lat: 0, lng: 0, country: '', region: 'Global', label: 'Location not stated' },
      source: item.feed,
      sourceUrl: item.link,
      confidence: 0.6, // headline-derived classification
      tags: ['cyber', kind.category, 'news'],
      metadata: { kind: kind.label, ...(victim ? { impacted: victim } : {}), ...(country ? {} : { unlocated: true }) },
    });
  }
  return events;
}
