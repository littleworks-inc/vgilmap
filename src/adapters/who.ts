/**
 * ReliefWeb Health Adapter — Epidemic & Disease Outbreaks
 */
import type { VigilEvent, Severity } from '../types';
interface RWDisaster {
  id: number;
  fields: {
    name: string;
    status: string;
    date?: { created?: string };
    type?: Array<{ name: string; primary?: boolean }>;
    country?: Array<{
      name: string;
      iso3?: string;
      location?: { lat: number; lon: number };
      primary?: boolean;
    }>;
  };
}
interface RWResponse { data?: RWDisaster[] }
const COUNTRY_COORDS: Record<string, [number, number]> = {
  'Democratic Republic of the Congo':[-4.0,21.8],'Congo':[-4.0,21.8],
  'Nigeria':[9.1,8.7],'Ethiopia':[9.1,40.5],'Somalia':[5.2,46.2],
  'Sudan':[12.9,30.2],'South Sudan':[6.9,31.3],'Uganda':[1.4,32.3],
  'Kenya':[-0.0,37.9],'Tanzania':[-6.4,34.9],'Rwanda':[-1.9,29.9],
  'Cameroon':[3.8,11.5],'Guinea':[11.4,-11.7],'Sierra Leone':[8.5,-11.8],
  'Liberia':[6.4,-9.4],'India':[20.6,79.0],'Pakistan':[30.4,69.3],
  'Bangladesh':[23.7,90.4],'Afghanistan':[33.9,67.7],
  'Indonesia':[-0.8,113.9],'Philippines':[12.9,121.8],
  'Vietnam':[14.1,108.3],'Myanmar':[21.9,96.0],'Haiti':[18.9,-72.3],
  'Mozambique':[-18.7,35.5],'Malawi':[-13.3,34.3],'Zimbabwe':[-19.0,29.2],
  'Madagascar':[-18.8,46.9],'Chad':[15.5,18.7],'Niger':[17.6,8.1],
};
function healthSeverity(status: string, name: string): Severity {
  if (status === 'alert') return 'critical';
  const n = name.toLowerCase();
  if (/ebola|marburg|cholera|plague/.test(n)) return 'high';
  if (/mpox|dengue|measles|typhoid/.test(n)) return 'medium';
  return status === 'current' ? 'medium' : 'low';
}
export async function fetchWHOOutbreaks(): Promise<VigilEvent[]> {
  const res = await fetch('https://api.reliefweb.int/v2/disasters?appname=vigilmap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      preset: 'latest',
      limit: 30,
      filter: { field: 'type.name', value: 'Epidemic' },
      fields: {
        include: [
          'name','status','date.created',
          'type.name',
          'country.name','country.iso3','country.location','country.primary',
        ],
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`ReliefWeb health fetch failed: ${res.status} — ${err.slice(0,200)}`);
  }
  const json: RWResponse = await res.json();
  const events: VigilEvent[] = [];
  for (const item of json.data ?? []) {
    const f = item.fields;
    const primaryCountry = f.country?.find(c => c.primary) ?? f.country?.[0];
    if (!primaryCountry) continue;
    let lat: number, lng: number;
    if (primaryCountry.location?.lat != null) {
      lat = primaryCountry.location.lat;
      lng = primaryCountry.location.lon;
    } else {
      const fb = COUNTRY_COORDS[primaryCountry.name];
      if (!fb) continue;
      [lat, lng] = fb;
    }
    events.push({
      id: `rw-health-${item.id}`,
      timestamp: f.date?.created ?? new Date().toISOString(),
      domain: 'health',
      category: 'outbreak',
      severity: healthSeverity(f.status, f.name),
      title: f.name,
      description: `Epidemic in ${primaryCountry.name}. Status: ${f.status}.`,
      location: { lat, lng, country: primaryCountry.name,
        region: primaryCountry.name, label: primaryCountry.name },
      source: 'ReliefWeb/OCHA',
      sourceUrl: `https://reliefweb.int/disaster/${item.id}`,
      confidence: 0.90,
      tags: ['epidemic','health',f.status,
        primaryCountry.iso3?.toLowerCase()??''].filter(Boolean),
      metadata: { status: f.status, country: primaryCountry.name },
    });
  }
  return events;
}
