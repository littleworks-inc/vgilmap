/**
 * ReliefWeb adapter — UN OCHA humanitarian disasters.
 *
 * Source: ReliefWeb's public Disasters RSS feed, via /api/reliefweb. (Its JSON API was retired,
 * and the replacement needs a registered app name; the RSS feed needs nothing.)
 *
 * Each item has the affected country and a GLIDE disaster ID whose prefix says what kind of
 * disaster it is (FL flood, EQ earthquake, EP epidemic, …), which we use to classify properly
 * instead of guessing from keywords.
 */
import type { VigilEvent, Severity, Domain } from '../types';
import { countryName, findCountries } from './countries';
import { decodeEntities, plain, tagText } from '../rss';

interface Kind {
  domain: Domain;
  category: string;
  label: string;
  severity: Severity;
}

// GLIDE hazard codes: https://glidenumber.net
const KINDS: Record<string, Kind> = {
  EQ: { domain: 'disaster', category: 'earthquake',      label: 'Earthquake',          severity: 'high' },
  VO: { domain: 'disaster', category: 'volcanic',        label: 'Volcano',             severity: 'high' },
  TS: { domain: 'disaster', category: 'tsunami',         label: 'Tsunami',             severity: 'high' },
  TC: { domain: 'disaster', category: 'hurricane',       label: 'Tropical cyclone',    severity: 'high' },
  FL: { domain: 'disaster', category: 'flood',           label: 'Flood',               severity: 'medium' },
  FF: { domain: 'disaster', category: 'flood',           label: 'Flash flood',         severity: 'medium' },
  LS: { domain: 'disaster', category: 'landslide',       label: 'Landslide',           severity: 'medium' },
  ST: { domain: 'climate',  category: 'extreme-weather', label: 'Severe storm',        severity: 'medium' },
  SS: { domain: 'climate',  category: 'extreme-weather', label: 'Storm surge',         severity: 'medium' },
  ET: { domain: 'climate',  category: 'extreme-weather', label: 'Extratropical cyclone', severity: 'medium' },
  CW: { domain: 'climate',  category: 'extreme-weather', label: 'Cold wave',           severity: 'medium' },
  HT: { domain: 'climate',  category: 'extreme-weather', label: 'Heat wave',           severity: 'medium' },
  DR: { domain: 'climate',  category: 'extreme-weather', label: 'Drought',             severity: 'medium' },
  WF: { domain: 'climate',  category: 'wildfire',        label: 'Wildfire',            severity: 'medium' },
  EP: { domain: 'health',   category: 'outbreak',        label: 'Epidemic',            severity: 'high' },
  CE: { domain: 'conflict', category: 'displacement',    label: 'Complex emergency',   severity: 'high' },
  FA: { domain: 'economic', category: 'food-insecurity', label: 'Famine',              severity: 'critical' },
};
const DEFAULT_KIND: Kind = { domain: 'disaster', category: 'other', label: 'Disaster', severity: 'medium' };

/** The description is HTML-escaped HTML; decode it and pull out the pieces we need (no DOM needed). */
function parseDescription(raw: string): { countries: string; glide: string; text: string } {
  const html = decodeEntities(raw);
  const field = (cls: string, prefix: RegExp) =>
    plain(html.match(new RegExp(`class="tag ${cls}"[^>]*>([\\s\\S]*?)<\\/div>`, 'i'))?.[1] ?? '').replace(prefix, '').trim();
  const countries = field('country', /^Affected countr(?:y|ies):\s*/i);
  const glide = field('glide', /^Glide:\s*/i);
  const para = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  const text = plain(para ?? html.replace(/<div class="tag[\s\S]*?<\/div>/gi, ' '));
  return { countries, glide, text };
}

/** Normalize ReliefWeb's Disasters RSS (raw XML text). */
export function normalizeReliefWeb(xml: string): VigilEvent[] {
  if (!/<(rss|feed)\b/i.test(xml)) throw new Error('ReliefWeb RSS could not be parsed');

  const events: VigilEvent[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const chunk = m[1];
    const title = plain(tagText(chunk, 'title'));
    const link = decodeEntities(tagText(chunk, 'link')) || 'https://reliefweb.int';
    const pub = tagText(chunk, 'pubDate');
    if (!title || !pub) continue;
    const when = new Date(pub);
    if (Number.isNaN(when.getTime())) continue;

    const { countries: countryText, glide, text } = parseDescription(tagText(chunk, 'description'));
    const kind = KINDS[glide.slice(0, 2).toUpperCase()] ?? DEFAULT_KIND;
    // Prefer the structured "Affected country" field; fall back to the title ("Haiti: Floods - Oct 2026").
    const matches = findCountries(countryText || title);
    const primary = matches[0];
    const names = matches.map(m => countryName(m.code));

    events.push({
      id: `reliefweb-${glide || link.split('/').pop()}`,
      timestamp: when.toISOString(),
      domain: kind.domain,
      category: kind.category,
      severity: kind.severity,
      title,
      description: text.length > 320 ? `${text.slice(0, 320)}…` : text || `${kind.label} reported by ReliefWeb.`,
      location: primary
        ? { lat: primary.coords[0], lng: primary.coords[1], country: primary.code, region: names.join(', '), label: names.join(', ') }
        : { lat: 0, lng: 0, country: '', region: 'ReliefWeb', label: countryText || 'Location not specified' },
      source: 'ReliefWeb',
      sourceUrl: link,
      confidence: 0.9,
      tags: [kind.label.toLowerCase(), 'humanitarian', 'reliefweb'],
      metadata: { glide, countries: names, kind: kind.label, ...(primary ? {} : { unlocated: true }) },
    });
  }
  return events;
}
