/**
 * Conflict adapters — two independent sources, registered separately in App.tsx so each one
 * loads and reports its own health:
 *
 *   fetchConflictNews → /api/conflict-rss  BBC / DW / Al Jazeera RSS. Fast (<1 s) and reliable.
 *   fetchGDELT        → /api/gdelt          GDELT Doc API. Slow (~13 s per request) and aggressively
 *                                          rate limited, so it often fails.
 *
 * They used to be one adapter that waited for both, which meant the fast RSS events sat hidden
 * behind GDELT's 20+ second wait.
 */
import type { VigilEvent, Severity } from '../types';
import { gdeltFetch, noteIfStale } from './gdelt-queue';
import { addWarning } from './source-warnings';
import { countryName, findCountries } from './countries';

// ─── Shared helpers ────────────────────────────────────────

function hashId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function severityFromTitle(title: string): Severity {
  const t = title.toLowerCase();
  if (/killed|dead|massacre|airstrike|bombing|explosion/.test(t)) return 'high';
  if (/attack|clash|conflict|fighting|troops|offensive/.test(t)) return 'medium';
  return 'low';
}

function seendateToISO(s: string): string {
  if (!s || s.length < 8) return new Date().toISOString();
  const d = s.replace('Z', '');
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T` +
    `${d.slice(9, 11) || '00'}:${d.slice(11, 13) || '00'}:00Z`;
}

/** Place a headline in the first country it names, or null (conflict events need a place). */
function place(text: string) {
  const m = findCountries(text)[0];
  return m ? { lat: m.coords[0], lng: m.coords[1], country: m.code, region: '', label: countryName(m.code) } : null;
}

// ─── Source 1: news RSS ────────────────────────────────────

interface NewsItem { title: string; link: string; date: string; description: string; feed: string }

export async function fetchConflictNews(): Promise<VigilEvent[]> {
  const res = await fetch('/api/conflict-rss');
  if (!res.ok) throw new Error(`conflict-rss proxy ${res.status}`);
  const json = (await res.json()) as { items?: NewsItem[]; feeds?: Array<{ name: string; ok: boolean }> };

  const failed = (json.feeds ?? []).filter(f => !f.ok).map(f => f.name);
  if (failed.length > 0) addWarning('conflict-rss', `${failed.join(', ')} feed unavailable`);

  const events: VigilEvent[] = [];
  for (const item of json.items ?? []) {
    const location = place(`${item.title} ${item.description}`);
    if (!location) continue;
    events.push({
      id: `news-${hashId(item.link || item.title)}`,
      timestamp: item.date,
      domain: 'conflict',
      category: 'armed-conflict',
      severity: severityFromTitle(item.title),
      title: item.title.slice(0, 140),
      description: item.description || 'News report.',
      location,
      source: item.feed,
      sourceUrl: item.link,
      confidence: 0.65, // headline-derived, location from the first country named
      tags: ['conflict', 'news', 'rss'],
      metadata: {},
    });
  }
  return events;
}

// ─── Source 2: GDELT ───────────────────────────────────────

interface GDELTArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
  sourcecountry: string;
}

export async function fetchGDELT(): Promise<VigilEvent[]> {
  const res = await gdeltFetch('/api/gdelt');
  if (!res.ok) throw new Error(`gdelt proxy ${res.status}`);
  noteIfStale('gdelt', res);
  const json = await res.json();

  const events: VigilEvent[] = [];
  for (const a of (json.articles ?? []) as GDELTArticle[]) {
    if (!a.title) continue;
    const location = place(a.title);
    if (!location) continue;
    events.push({
      id: `gdelt-${hashId(a.url ?? a.title)}`,
      timestamp: seendateToISO(a.seendate),
      domain: 'conflict',
      category: 'armed-conflict',
      severity: severityFromTitle(a.title),
      title: a.title,
      description: `Reported by ${a.domain ?? 'news source'}.`,
      location,
      source: 'GDELT',
      sourceUrl: a.url,
      confidence: 0.70,
      tags: ['conflict', 'news'],
      metadata: {},
    });
  }
  return events;
}
