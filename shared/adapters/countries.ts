/**
 * Shared country lookup for adapters whose sources give a country NAME but no coordinates
 * (WHO outbreak titles, ReliefWeb "Affected country", ransomware ISO codes).
 *
 * Coordinates are rough country centroids, so events placed with them are country-accurate
 * only. Adapters should treat that as approximate.
 */

/** ISO 3166-1 alpha-2 → [lat, lng] centroid. */
export const COUNTRY_COORDS: Record<string, [number, number]> = {
  // North & Central America, Caribbean
  US: [39.8, -98.6], CA: [56.1, -106.3], MX: [23.6, -102.5], GT: [15.8, -90.2], BZ: [17.2, -88.5],
  HN: [15.2, -86.2], SV: [13.8, -88.9], NI: [12.9, -85.2], CR: [9.7, -83.8], PA: [8.5, -80.8],
  CU: [21.5, -77.8], JM: [18.1, -77.3], HT: [18.9, -72.3], DO: [18.7, -70.2], PR: [18.2, -66.6],
  BS: [25.0, -77.4], BB: [13.2, -59.5], TT: [10.7, -61.2], GD: [12.1, -61.7], LC: [13.9, -61.0],
  VC: [13.3, -61.2], AG: [17.1, -61.8], DM: [15.4, -61.4], KN: [17.4, -62.8],
  // South America
  BR: [-14.2, -51.9], AR: [-38.4, -63.6], CL: [-35.7, -71.5], CO: [4.6, -74.3], PE: [-9.2, -75.0],
  VE: [6.4, -66.6], EC: [-1.8, -78.2], BO: [-16.3, -63.6], PY: [-23.4, -58.4], UY: [-32.5, -55.8],
  GY: [4.9, -58.9], SR: [3.9, -56.0],
  // Europe
  GB: [54.0, -2.0], IE: [53.4, -8.2], FR: [46.2, 2.2], DE: [51.2, 10.4], ES: [40.5, -3.7],
  PT: [39.4, -8.2], IT: [41.9, 12.6], NL: [52.1, 5.3], BE: [50.5, 4.5], LU: [49.8, 6.1],
  CH: [46.8, 8.2], AT: [47.5, 14.6], DK: [56.3, 9.5], SE: [60.1, 18.6], NO: [60.5, 8.5],
  FI: [61.9, 25.7], IS: [64.9, -19.0], PL: [51.9, 19.1], CZ: [49.8, 15.5], SK: [48.7, 19.7],
  HU: [47.2, 19.5], RO: [45.9, 24.9], BG: [42.7, 25.5], GR: [39.1, 21.8], HR: [45.1, 15.2],
  SI: [46.2, 14.9], RS: [44.0, 21.0], BA: [43.9, 17.7], AL: [41.2, 20.2], MK: [41.6, 21.7],
  ME: [42.7, 19.4], XK: [42.6, 20.9], EE: [58.6, 25.0], LV: [56.9, 24.6], LT: [55.2, 23.9],
  UA: [48.4, 31.2], BY: [53.7, 27.9], MD: [47.4, 28.4], RU: [61.5, 105.3], MT: [35.9, 14.4],
  CY: [35.1, 33.4], AD: [42.5, 1.5], MC: [43.7, 7.4], SM: [43.9, 12.5], LI: [47.2, 9.6],
  // Middle East & Central Asia
  TR: [38.96, 35.2], IL: [31.0, 34.9], PS: [31.9, 35.2], LB: [33.9, 35.9], JO: [30.6, 36.2],
  SA: [23.9, 45.1], AE: [23.4, 53.8], QA: [25.4, 51.2], KW: [29.3, 47.5], BH: [26.0, 50.6],
  OM: [21.5, 55.9], IQ: [33.2, 43.7], IR: [32.4, 53.7], SY: [34.8, 39.0], YE: [15.6, 48.5],
  AM: [40.1, 45.0], AZ: [40.1, 47.6], GE: [42.3, 43.4], KZ: [48.0, 66.9], UZ: [41.4, 64.6],
  TM: [38.97, 59.6], TJ: [38.9, 71.3], KG: [41.2, 74.8], AF: [33.9, 67.7],
  // Africa
  EG: [26.8, 30.8], MA: [31.8, -7.1], DZ: [28.0, 1.7], TN: [33.9, 9.5], LY: [26.3, 17.2],
  SD: [12.9, 30.2], SS: [6.9, 31.3], ER: [15.2, 39.8], DJ: [11.8, 42.6], ET: [9.1, 40.5],
  SO: [5.2, 46.2], KE: [-0.02, 37.9], UG: [1.4, 32.3], TZ: [-6.4, 34.9], RW: [-1.9, 29.9],
  BI: [-3.4, 29.9], CD: [-4.0, 21.8], CG: [-0.2, 15.8], CF: [6.6, 20.9], CM: [7.4, 12.4],
  TD: [15.5, 18.7], NE: [17.6, 8.1], NG: [9.1, 8.7], BJ: [9.3, 2.3], TG: [8.6, 0.8],
  GH: [7.9, -1.0], CI: [7.5, -5.5], BF: [12.4, -1.5], ML: [17.6, -4.0], MR: [21.0, -10.9],
  SN: [14.5, -14.5], GM: [13.4, -15.3], GW: [11.8, -15.2], GN: [11.4, -11.7], SL: [8.5, -11.8],
  LR: [6.4, -9.4], CV: [16.0, -24.0], GA: [-0.8, 11.6], GQ: [1.7, 10.3], ST: [0.2, 6.6],
  AO: [-11.2, 17.9], ZM: [-13.1, 27.8], ZW: [-19.0, 29.2], MW: [-13.3, 34.3], MZ: [-18.7, 35.5],
  MG: [-18.8, 46.9], MU: [-20.3, 57.6], SC: [-4.7, 55.5], KM: [-11.9, 43.9], BW: [-22.3, 24.7],
  NA: [-22.96, 18.5], ZA: [-30.6, 22.9], LS: [-29.6, 28.2], SZ: [-26.5, 31.5],
  // Asia
  IN: [20.6, 78.96], PK: [30.4, 69.3], BD: [23.7, 90.4], LK: [7.9, 80.8], NP: [28.4, 84.1],
  BT: [27.5, 90.4], MV: [3.2, 73.2], CN: [35.9, 104.2], HK: [22.3, 114.2], MO: [22.2, 113.5],
  TW: [23.7, 121.0], JP: [36.2, 138.3], KR: [35.9, 127.8], KP: [40.3, 127.5], MN: [46.9, 103.8],
  TH: [15.9, 100.99], VN: [14.1, 108.3], LA: [19.9, 102.5], KH: [12.6, 104.99], MM: [21.9, 95.96],
  MY: [4.2, 101.98], SG: [1.35, 103.8], BN: [4.5, 114.7], ID: [-0.8, 113.9], PH: [12.9, 121.8],
  TL: [-8.9, 125.7],
  // Oceania
  AU: [-25.3, 133.8], NZ: [-40.9, 174.9], PG: [-6.3, 143.96], FJ: [-17.7, 178.1], SB: [-9.6, 160.2],
  VU: [-15.4, 166.96], WS: [-13.8, -172.1], TO: [-21.2, -175.2], KI: [1.9, -157.4], FM: [6.9, 158.2],
  PW: [7.5, 134.6], MH: [7.1, 171.2], NR: [-0.5, 166.9], TV: [-7.1, 177.6],
};

/** Names a source might use that CLDR's English region names don't produce. */
const ALIASES: Record<string, string> = {
  'united states of america': 'US', 'usa': 'US', 'u.s.': 'US',
  'united kingdom of great britain and northern ireland': 'GB', 'uk': 'GB', 'britain': 'GB', 'great britain': 'GB',
  'democratic republic of the congo': 'CD', 'dr congo': 'CD', 'drc': 'CD', 'congo (the democratic republic of the)': 'CD',
  'republic of the congo': 'CG', 'congo': 'CG',
  'türkiye': 'TR', 'turkey': 'TR', 'viet nam': 'VN', 'vietnam': 'VN',
  "côte d'ivoire": 'CI', 'cote d\'ivoire': 'CI', 'ivory coast': 'CI',
  'czech republic': 'CZ', 'czechia': 'CZ', 'burma': 'MM', 'swaziland': 'SZ', 'eswatini': 'SZ',
  'occupied palestinian territory': 'PS', 'palestine': 'PS', 'gaza': 'PS', 'gaza strip': 'PS', 'west bank': 'PS',
  'syrian arab republic': 'SY', 'iran (islamic republic of)': 'IR', 'islamic republic of iran': 'IR',
  "lao people's democratic republic": 'LA', 'laos': 'LA',
  'united republic of tanzania': 'TZ', 'republic of korea': 'KR', 'south korea': 'KR',
  "democratic people's republic of korea": 'KP', 'north korea': 'KP',
  'russian federation': 'RU', 'republic of moldova': 'MD', 'bolivia (plurinational state of)': 'BO',
  'venezuela (bolivarian republic of)': 'VE', 'micronesia (federated states of)': 'FM', 'cabo verde': 'CV',
  'cape verde': 'CV', 'timor-leste': 'TL', 'east timor': 'TL', 'the gambia': 'GM', 'north macedonia': 'MK',
  'kosovo': 'XK', 'hong kong': 'HK', 'macau': 'MO', 'taiwan': 'TW', 'brunei': 'BN',
};

/**
 * CLDR names differ from how sources write them: "Myanmar (Burma)", "Bosnia & Herzegovina",
 * "St. Lucia", "Côte d’Ivoire" (curly apostrophe). Index each plausible spelling.
 */
function variants(name: string): string[] {
  const base = name.toLowerCase().replace(/’/g, "'");
  const out = new Set<string>([base]);
  const noParens = base.replace(/\s*\([^)]*\)/g, '').trim();   // "myanmar (burma)" → "myanmar"
  if (noParens) out.add(noParens);
  for (const v of [...out]) {
    out.add(v.replace(/&/g, 'and'));                                   // "bosnia & herzegovina"
    out.add(v.replace(/\bst\.\s*/g, 'saint '));                        // "st. lucia" → "saint lucia"
  }
  return [...out];
}

interface NameEntry { name: string; code: string }
let nameIndex: NameEntry[] | null = null;

/** Every known name (CLDR English names + aliases), longest first so "South Sudan" beats "Sudan". */
function names(): NameEntry[] {
  if (nameIndex) return nameIndex;
  const out: NameEntry[] = [];
  let display: Intl.DisplayNames | null = null;
  try { display = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* aliases only */ }
  for (const code of Object.keys(COUNTRY_COORDS)) {
    let n: string | undefined;
    try { n = display?.of(code); } catch { /* ignore */ }
    if (n && n !== code) for (const v of variants(n)) out.push({ name: v, code });
  }
  for (const [name, code] of Object.entries(ALIASES)) out.push({ name, code });
  out.sort((a, b) => b.name.length - a.name.length);
  nameIndex = out;
  return out;
}

export interface CountryMatch { code: string; coords: [number, number] }

/**
 * All countries mentioned in `text`, in order of appearance. Whole-name matches only (so "Niger"
 * doesn't match inside "Nigeria"), and a longer name consumes its span first (so the "Sudan" in
 * "South Sudan" isn't reported separately).
 */
export function findCountries(text: string): CountryMatch[] {
  if (!text) return [];
  let work = text.toLowerCase().replace(/’/g, "'");
  const found: Array<{ at: number; code: string }> = [];

  for (const { name, code } of names()) {
    let from = 0;
    for (;;) {
      const i = work.indexOf(name, from);
      if (i === -1) break;
      const before = i === 0 ? '' : work[i - 1];
      const after = work[i + name.length] ?? '';
      const isWord = (c: string) => c !== '' && /\p{L}/u.test(c);
      if (!isWord(before) && !isWord(after)) {
        found.push({ at: i, code });
        work = work.slice(0, i) + ' '.repeat(name.length) + work.slice(i + name.length); // consume the span
      }
      from = i + name.length;
    }
  }

  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .filter(f => (seen.has(f.code) ? false : (seen.add(f.code), true)))
    .map(f => ({ code: f.code, coords: COUNTRY_COORDS[f.code] }));
}

// CLDR names like "Congo - Kinshasa" or "Myanmar (Burma)" read oddly in event titles and labels.
const DISPLAY_NAMES: Record<string, string> = {
  CD: 'DR Congo', CG: 'Republic of the Congo', MM: 'Myanmar', PS: 'Palestine', HK: 'Hong Kong', MO: 'Macao',
};

export function countryName(code: string): string {
  if (DISPLAY_NAMES[code]) return DISPLAY_NAMES[code];
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code; } catch { return code; }
}
