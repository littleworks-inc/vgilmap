/**
 * Economic & labor news adapter — replaces the GDELT-based one.
 *
 * Source: /api/economic-rss (BBC Business, DW Business, Guardian Economics & Global Development,
 * Al Jazeera, NPR Business), already filtered server-side to crisis / labor headlines. GDELT's rate
 * limiting made the previous source unavailable most of the time; these feeds answer in <1 s.
 *
 * Location is the first country named in the headline/summary. Headlines that name no country are
 * dropped: they are mostly corporate or global news that happens to match a keyword.
 */
import type { VigilEvent, Severity, Domain } from '../types';
import { addWarning } from './source-warnings';
import { countryName, findCountries } from './countries';

interface NewsItem { title: string; link: string; date: string; description: string; feed: string }

function hashId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function severityFromTitle(title: string): Severity {
  const t = title.toLowerCase();
  if (/crisis|collapse|default|emergency|crash|hyperinflation|famine|bank run/.test(t)) return 'high';
  if (/sanction|protest|on strike|strike action|surge|inflation|layoff|job cuts|shortage|bankrupt/.test(t)) return 'medium';
  return 'low';
}

function domainFromTitle(title: string): Domain {
  return /on strike|general strike|strike action|strikers?|walkout|worker|trade union|labou?r union|layoff|lay-off|job cuts|redundanc|unemploy|industrial action|wage/i.test(title)
    ? 'labor'
    : 'economic';
}

export async function fetchEconomicNews(): Promise<VigilEvent[]> {
  const res = await fetch('/api/economic-rss');
  if (!res.ok) throw new Error(`economic-rss proxy ${res.status}`);
  const json = (await res.json()) as { items?: NewsItem[]; feeds?: Array<{ name: string; ok: boolean }> };

  const failed = (json.feeds ?? []).filter(f => !f.ok).map(f => f.name);
  if (failed.length > 0) addWarning('economic-news', `${failed.join(', ')} feed unavailable`);

  const events: VigilEvent[] = [];
  const seen = new Set<string>();
  for (const item of json.items ?? []) {
    const match = findCountries(`${item.title} ${item.description}`)[0];
    if (!match) continue;
    const id = `econ-news-${hashId(item.link || item.title)}`;
    if (seen.has(id)) continue; // the same story can appear in several feeds
    seen.add(id);

    const domain = domainFromTitle(item.title);
    events.push({
      id,
      timestamp: item.date,
      domain,
      category: domain === 'labor' ? 'strike' : 'unemployment',
      severity: severityFromTitle(item.title),
      title: item.title.slice(0, 140),
      description: item.description || 'News report.',
      location: {
        lat: match.coords[0], lng: match.coords[1], country: match.code, region: '', label: countryName(match.code),
      },
      source: item.feed,
      sourceUrl: item.link,
      confidence: 0.6, // headline-derived
      tags: [domain, 'news', 'rss'],
      metadata: {},
    });
  }
  return events;
}
