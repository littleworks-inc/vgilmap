/**
 * Data breaches — Have I Been Pwned's public breach catalogue, via /api/breaches.
 *
 * This is the clearest "who was impacted" source: each breach names the organisation, how many
 * accounts were exposed, and which kinds of data leaked. Timestamp is when HIBP ADDED the breach
 * (the breach itself is often years older; that date is kept in metadata).
 *
 * HIBP gives no country. For a country-code domain (.de, .jp …) we place the event in that country;
 * everything else is flagged `unlocated` (list only), never given a made-up position.
 * Data © Troy Hunt / Have I Been Pwned, CC BY 4.0.
 */
import type { VigilEvent, Severity } from '../types';
import { COUNTRY_COORDS, countryName } from './countries';

interface Breach {
  name: string;
  title: string;
  domain: string;
  breachDate: string;
  addedDate: string;
  pwnCount: number;
  dataClasses: string[];
  description: string;
  verified: boolean;
  sensitive: boolean;
}

// Two-letter TLDs that are used generically rather than to mean the country.
const GENERIC_CCTLD = new Set(['io', 'ai', 'tv', 'me', 'co', 'cc', 'fm', 'ly', 'to', 'ws', 'sh', 'gg', 'im', 'nu', 'vc', 'la', 'gl', 'ac', 'ag', 'bz', 'dj', 'gd', 'ms', 'mu', 'st', 'cx', 'tk', 'ml', 'ga', 'cf', 'gq', 'su', 'eu']);

function countryFromDomain(domain: string): string | null {
  const tld = domain.toLowerCase().split('.').pop() ?? '';
  if (tld.length !== 2 || GENERIC_CCTLD.has(tld)) return null;
  const code = tld === 'uk' ? 'GB' : tld.toUpperCase();
  return COUNTRY_COORDS[code] ? code : null;
}

function severity(count: number, sensitive: boolean): Severity {
  if (count >= 10_000_000 || sensitive) return 'critical';
  if (count >= 1_000_000) return 'high';
  if (count >= 100_000) return 'medium';
  return 'low';
}

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(n);

export function normalizeBreaches({ breaches }: { breaches?: Breach[] }): VigilEvent[] {

  return (breaches ?? []).map((b): VigilEvent => {
    const code = countryFromDomain(b.domain);
    const where = code ? { lat: COUNTRY_COORDS[code][0], lng: COUNTRY_COORDS[code][1], country: code, region: countryName(code), label: countryName(code) } : null;
    const types = b.dataClasses.slice(0, 4).join(', ');
    return {
      id: `cyber-breach-${b.name}-${b.addedDate.slice(0, 10)}`,
      timestamp: new Date(b.addedDate).toISOString(),
      domain: 'cyber',
      category: 'data-breach',
      severity: severity(b.pwnCount, b.sensitive),
      title: `Data breach: ${b.title} (${compact(b.pwnCount)} accounts)`,
      description: `${b.title} — ${b.pwnCount.toLocaleString()} accounts exposed${types ? `: ${types}` : ''}. ${b.description}`.slice(0, 340),
      location: where ?? { lat: 0, lng: 0, country: '', region: 'Global', label: b.domain || 'Location unknown' },
      source: 'Have I Been Pwned',
      sourceUrl: `https://haveibeenpwned.com/PwnedWebsites#${encodeURIComponent(b.name)}`,
      confidence: b.verified ? 0.95 : 0.8,
      tags: ['data-breach', ...(b.sensitive ? ['sensitive'] : []), ...b.dataClasses.slice(0, 3).map(d => d.toLowerCase())],
      metadata: {
        impacted: b.title, domain: b.domain, pwnCount: b.pwnCount, dataClasses: b.dataClasses,
        breachDate: b.breachDate, verified: b.verified, ...(where ? {} : { unlocated: true }),
      },
    };
  });
}
