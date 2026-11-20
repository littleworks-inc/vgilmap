/**
 * WHO Disease Outbreak News (DON) adapter.
 *
 * Source: WHO's official DON API (CORS-enabled, no key). This replaces the general WHO news RSS
 * feed we used before, which mostly returned unrelated items and, at the time it was replaced,
 * nothing newer than 2020.
 *
 * DON titles name the disease and place ("Chikungunya virus disease - Switzerland"). WHO provides
 * no coordinates, so we resolve the country from the title. Outbreaks with no single country
 * (regional or global ones) are flagged `unlocated`: they appear in lists but not on the map,
 * rather than being given a made-up position.
 */
import type { VigilEvent, Severity } from '../types';
import { countryName, findCountries } from './countries';

const DON_URL =
  'https://www.who.int/api/news/diseaseoutbreaknews' +
  '?$select=Title,UrlName,ItemDefaultUrl,PublicationDateAndTime,Summary' +
  '&$orderby=PublicationDateAndTime%20desc&$top=30';

interface DONItem {
  Title?: string;
  UrlName?: string;
  ItemDefaultUrl?: string;
  PublicationDateAndTime?: string;
  Summary?: string;
}

const HIGH = /ebola|marburg|plague|cholera|anthrax|nipah|lassa|crimean|rift valley|mers\b|middle east respiratory|avian influenza|h5n1|h7n9|polio|yellow fever|smallpox|hemorrhagic|haemorrhagic/i;
const MEDIUM = /measles|dengue|chikungunya|meningitis|diphtheria|zika|west nile|oropouche|influenza|mpox|monkeypox|typhoid|rabies|hepatitis|legionell|botulism/i;

function severity(title: string): Severity {
  if (HIGH.test(title)) return 'high';
  if (MEDIUM.test(title)) return 'medium';
  return 'low';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Disease part of the title, e.g. "Ebola disease caused by Bundibugyo virus". */
function diseaseOf(title: string): string {
  return title.split(/\s[-–—]\s|,/)[0].trim();
}

export async function fetchWHOOutbreaks(): Promise<VigilEvent[]> {
  const res = await fetch(DON_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`WHO DON API returned ${res.status}`);
  const json = (await res.json()) as { value?: DONItem[] };
  const items = json.value ?? [];

  const events: VigilEvent[] = [];
  for (const it of items) {
    if (!it.Title || !it.UrlName || !it.PublicationDateAndTime) continue;

    const countries = findCountries(it.Title);
    const primary = countries[0];
    const names = countries.map(c => countryName(c.code));
    const disease = diseaseOf(it.Title);
    const summary = stripHtml(it.Summary ?? '');

    events.push({
      id: `who-don-${it.UrlName}`,
      timestamp: new Date(it.PublicationDateAndTime).toISOString(),
      domain: 'health',
      category: 'outbreak',
      severity: severity(it.Title),
      title: `WHO: ${it.Title}`,
      description: summary.length > 320 ? `${summary.slice(0, 320)}…` : summary || 'WHO Disease Outbreak News.',
      location: primary
        ? {
            lat: primary.coords[0],
            lng: primary.coords[1],
            country: primary.code,
            region: names.join(', '),
            label: names.join(', '),
          }
        : { lat: 0, lng: 0, country: '', region: 'WHO', label: 'Regional / multi-country' },
      source: 'WHO DON',
      sourceUrl: `https://www.who.int/emergencies/disease-outbreak-news/item${it.ItemDefaultUrl ?? `/${it.UrlName}`}`,
      confidence: 0.97, // official WHO publication
      tags: ['outbreak', 'who-don', disease.toLowerCase()],
      metadata: {
        disease,
        countries: names,
        ...(primary ? {} : { unlocated: true }),
      },
    });
  }
  return events;
}
