# 🌍 VigilMap

**Open-source global intelligence platform** — real-time monitoring of earthquakes, wildfires, weather alerts, conflict, and disease outbreaks on an interactive 3D globe.

[![Live Demo](https://img.shields.io/badge/demo-live-22c55e?style=flat-square)](https://vgilmap.vercel.app)
[![MIT License](https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square)](LICENSE)
[![Deploy with Vercel](https://img.shields.io/badge/deploy-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com/new/clone?repository-url=https://github.com/littleworks-inc/vgilmap)

---

## What it does

VigilMap aggregates **13 data sources** (12 core, 1 optional extra) into a single dark-mode globe. Events are colour-coded by domain, clustered at low zoom, and filtered by one time window.

It is a monitor, not a ground-truth feed: every layer has limits, and each event says how precisely it is located. The table below is generated from `shared/pipeline/sources.ts`, the same definitions the app and API run on.

| Source | Coverage and limits | Location accuracy | Refresh |
|---|---|---|---|
| 🌋 USGS 24h | Global earthquakes of every magnitude, last 24 hours | Exact location | every 2 min |
| 🌋 USGS Significant | Global earthquakes of M4.5+, last 7 days | Exact location | every 15 min |
| 🌩 NASA FIRMS | Global satellite fire detections, last 24 hours. Sampled: only the ~50 strongest (by radiative power) are kept, and low-confidence detections are dropped | Exact location | every 30 min |
| 🌩 NOAA Alerts | United States and territories only. Alerts without a polygon are listed but not placed on the map. An alert drops off when it ends, even if we are serving a retained copy of the feed | Area centre | every 5 min |
| ⚔️ Conflict News (RSS) | English-language headlines (BBC, DW, Al Jazeera, Guardian, NPR) that name a country; placed at that country, not at the event | Country estimate | every 10 min |
| ⚔️ GDELT Conflict *(optional)* | Global news index; often rate-limited, so treated as an optional extra | Country estimate | every 15 min |
| 🏥 WHO Outbreak News | Global, but WHO publishes only a few Disease Outbreak News items a month | Country estimate | every 1 h |
| 🌋 ReliefWeb Disasters | Global UN OCHA disaster declarations (a handful a month), placed at the affected country | Country estimate | every 1 h |
| 💰 Economic & Labor News | English-language strike and jobs headlines that name a country; placed at that country | Country estimate | every 15 min |
| 🔬 NASA Space Weather | Solar flares (NOAA, M/X class), geomagnetic storms and near-Earth asteroids. Not tied to a place on Earth, so list-only | No location | every 15 min |
| 🛡️ Ransomware & KEV | Ransomware victim claims (published by the attackers, unverified; placed at the victim country) and CISA KEV exploited vulnerabilities (no location) | Country estimate | every 15 min |
| 🛡️ Data Breaches (HIBP) | Breaches catalogued by Have I Been Pwned; the country is guessed from the site domain, otherwise list-only | Country estimate | every 1 h |
| 🛡️ Cyber Incident News | Headlines from security outlets classified by keywords; the country named in the headline, never the attacker nation | Country estimate | every 10 min |

**Location accuracy.** *Exact* = a measured position (earthquake epicentre, satellite fire pixel). *Area centre* = the middle of an affected area. *Country estimate* = the centre of the country named in a headline or report, **not where it happened**. Events with no real place (CISA KEV, space weather, NOAA alerts without a polygon) are list-only: they appear in the sidebar under **No location**, never on the map. The map popup, list rows and Data Health panel all say which applies.

---

## Features

- **Interactive globe** — MapLibre GL, CartoDB Dark Matter tiles, cluster expansion on zoom
- **Event concentrations** — compares event counts across regions in the current snapshot (Welford mean/variance, z-score). This is *not* a historical anomaly detector: there are no per-region baselines yet, so an always-busy region will still stand out
- **AI World Brief** — NVIDIA NIM (Gemma 4 / MiniMax / Nemotron cascade, via a server-side proxy) summarizes the top 8 events into a concise intelligence brief
- **Live ticker** — scrolling event feed at the bottom of the map
- **Mobile responsive** — full-screen map with swipeable bottom drawer on phones
- **One pipeline** — the app and the public REST API read the same normalized dataset; per-source health, last-good retention and per-source refresh intervals
- **Public REST API** — `/api/v1/events` and `/api/v1/summary`, free to use
- **Auto-rotate** — globe slowly drifts when idle, stops on any interaction, resumes after 30s
- **Zero paid APIs required** — everything works on free tiers out of the box

---

## Live demo

**[vgilmap.vercel.app](https://vgilmap.vercel.app)**

```bash
# Try the API
curl https://vgilmap.vercel.app/api/v1/events?severity=high&limit=10
curl https://vgilmap.vercel.app/api/v1/summary
```

---

## Quick start

```bash
git clone https://github.com/littleworks-inc/vgilmap
cd vgilmap
npm install
cp .env.example .env.local   # add your API keys (all optional)

# Two terminals: the API routes (api/*) run in a local server, and Vite proxies /api to it.
npm run dev:api              # terminal 1 → http://127.0.0.1:8787 (reads .env.local)
npm run dev                  # terminal 2 → http://localhost:5173
```

Open [localhost:5173](http://localhost:5173). Without `npm run dev:api` the map stays empty, because every data source is served through `/api/v1/events`. (`vercel dev` also works if you have the Vercel CLI.)

Other scripts: `npm test` (vitest), `npm run typecheck` (app **and** `api/`), `npm run lint`, `npm run build` (type-checks app and `api/` before building).

### Environment variables

| Variable | Required | Where to get it |
|----------|----------|-----------------|
| `NVIDIA_API_KEY` | Optional | [build.nvidia.com](https://build.nvidia.com) — server-side only (Vercel env var), powers `/api/brief` |
| `NASA_FIRMS_API_KEY` | Optional (server-side; legacy `VITE_NASA_FIRMS_API_KEY` also read) | [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/api/map_key/) — free |

Without these keys the app still works — AI briefs show an auto-generated fallback, NASA uses the public `DEMO_KEY` (rate-limited).

---

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/littleworks-inc/vgilmap)

1. Click the button above
2. Add your environment variables in the Vercel dashboard
3. Deploy — done in ~60 seconds

All edge functions in `api/` deploy automatically. No server configuration needed.

---

## Architecture

```
shared/                          # Runs in the browser AND on the server; pure, no network, no secrets
├── types.ts                     # VigilEvent unified schema, location precision
├── rss.ts                       # RSS/RDF parser (no DOM)
├── adapters/                    # One normalizer per source: raw upstream data → VigilEvent[]
│   ├── usgs.ts, usgs-significant-week.ts, nasa-firms.ts, noaa.ts, who.ts, reliefweb.ts
│   ├── gdelt.ts                 # conflict news RSS + GDELT
│   ├── economic-news.ts, science.ts
│   └── cyber.ts, cyber-breaches.ts, cyber-news.ts, countries.ts
└── pipeline/
    ├── sources.ts               # Source definitions: key, freshness, refresh interval, coverage, precision
    ├── engine.ts                # Runs sources; keeps each source's last good data; per-source health
    ├── query.ts                 # Merge + dedupe, filters, pagination, summaries (totals before pagination)
    ├── health.ts                # ok / degraded / stale / empty / error classifier
    └── precision.ts             # Location precision labels

api/                             # Vercel edge functions (server only: upstream URLs and secrets live here)
├── v1/events.ts                 # THE dataset: app and public API. ?source= selects sources
├── v1/summary.ts                # Counts over the full filtered dataset + source health
├── _lib/sources.ts              # Upstream fetching bound to the shared normalizers
├── _lib/pipeline.ts             # runPipeline + cache headers
├── firms.ts, cyber.ts, ...      # Raw upstream proxies, called in-process by _lib/sources.ts
├── brief.ts                     # AI brief (NVIDIA NIM)
└── cyber-trends.ts, cron/       # Redis-backed cyber history (optional)

src/                             # The app
├── data/pipeline.ts             # fetchSource(key): one source of /api/v1/events
├── intelligence/anomaly.ts      # Event concentrations
├── components/, map/, hooks/, utils/, health/
└── App.tsx                      # Loads each source on its own interval; keeps last good data

tests/                           # vitest: engine, query/pagination, normalizers, API end-to-end
scripts/                         # dev-api.ts (local API server), backfill-cyber.ts
```

**Data flow.** `api/_lib/sources.ts` fetches each upstream and passes the raw data to the shared normalizer. `shared/pipeline/engine.ts` runs the sources, stamps location precision, classifies health, and remembers each source's last good result. `api/v1/events` merges, filters and paginates. The app requests one source at a time (`/api/v1/events?source=<key>`), so a slow source never blocks the rest, and each source refreshes on its own interval (2 min for earthquakes up to 1 h for WHO). If a refresh fails, that source's last good events stay on the map, flagged *Stale · refresh failed* in Data Health. The edge cache TTL follows the same per-source interval.

**Last-good data** is kept per source in memory on each function instance and in the browser, so it survives a flaky upstream but not a cold start. Sources built from several feeds (ransomware.live + CISA KEV, the news RSS sources, the three NASA space-weather feeds) retain data **per feed**: when one feed fails, its earlier events stay and only the failed feed is flagged. Each feed's data keeps its own fetch time: a partly retained source reports the *oldest* contributing time as `dataAt`, `retained: true`, and a per-feed `parts` list, so retained data never looks fresher than it is. Durable storage is only used for cyber history (Upstash Redis).

### Unified event schema

Every normalizer (`shared/adapters/*`) turns its source data into `VigilEvent`:

```typescript
interface VigilEvent {
  id: string
  timestamp: string        // ISO 8601
  domain: Domain           // 'disaster' | 'climate' | 'health' | 'conflict' | ...
  category: Category       // 'earthquake' | 'wildfire' | 'outbreak' | ...
  severity: Severity       // 'info' | 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  location: {
    precision?: 'exact' | 'area' | 'country' | 'unknown'   // set by the pipeline
    lat: number
    lng: number
    country: string
    region: string
    label: string
  }
  source: string           // 'USGS' | 'NASA FIRMS' | 'WHO' | ...
  sourceUrl: string
  confidence: number       // 0–1
  expiresAt?: string       // when it stops being current (e.g. a weather alert's end); absent = no natural end
  lifecycle?: 'active' | 'expired'   // derived when served, from the clock
  tags: string[]
  metadata?: Record<string, unknown>
}
```

### How event concentrations work

`src/intelligence/anomaly.ts` runs in the browser with no dependencies. It is a within-snapshot comparison, **not** a historical anomaly detector:

1. **Measured clusters:** groups events with a measured position (exact / area) by domain + 10°×10° cell
2. **Reports by country:** events known only to a country (headlines, WHO, ransomware claims) are counted per country instead. They are *never* put on the grid, because unrelated reports that share one country-centre point would look like a geographic cluster
3. Computes Welford mean and standard deviation of the counts per domain and z-scores each group: `z = (count - mean) / stddev`. List-only events are excluded from both

It says "this region has more events than other regions right now", not "this is unusual for this region". True anomalies need per-region, per-source baselines, which need stored history.

---

## REST API

Free to use, no API key required.

### GET /api/v1/events

The same dataset the app uses.

```bash
curl "https://vgilmap.vercel.app/api/v1/events?severity=high&limit=10"
curl "https://vgilmap.vercel.app/api/v1/events?domain=cyber&location=nomap"   # list-only events
curl "https://vgilmap.vercel.app/api/v1/events?source=usgs-day,noaa&limit=1000&cursor=<next_cursor>"
```

| Param | Type | Description |
|-------|------|-------------|
| `domain` | string | Comma-separated: `disaster`, `climate`, `health`, `conflict`, `economic`, `labor`, `science`, `cyber` |
| `source` | string | Comma-separated source keys (see `shared/pipeline/sources.ts`). Default: every source except the optional GDELT extra |
| `optional` | `1` | Include optional sources in a whole-dataset request |
| `severity` | string | Minimum level: `info`, `low`, `medium`, `high`, `critical` |
| `since` | ISO datetime | Only events after this timestamp |
| `location` | `map` / `nomap` | Only events with / without a place on the map |
| `lifecycle` | `active` (default) / `expired` / `all` | Events whose `expiresAt` has passed are hidden by default |
| `limit` | integer | Page size, 1 to 1000 (default 100). Out-of-range values are rejected, not clamped |
| `cursor` | string | Pass `next_cursor` from the previous response to get the next page |

`total` and `summary` describe **everything matching the filters, before pagination**. Pages use a keyset cursor over a stable order (newest first, ties by id), so events arriving or expiring between requests can never repeat or skip an event; `offset` is not supported. Unsupported filter values, impossible dates (`2026-02-30`), out-of-range limits, bad cursors and explicitly empty filters (`?source=`) are rejected with **400** and the list of valid values, never silently ignored or corrected. `sources` reports each source's health, whether it is being served from retained (stale) data, its coverage and its location precision. The response is `503` (never cached) only when no selected source can serve anything. Edge caching uses each source's *remaining* freshness (a WHO snapshot that is already 59 minutes old is cached for one more minute, not another hour), and a partial or failed source is held for only 30 seconds before upstream is asked again. A response is also never cached past the moment an alert in it ends (`next_expiry`), and an event's `lifecycle` is computed from the clock when it is served, so a cached or retained alert stops being shown as current once it expires. The server keeps one snapshot per source, so different filters and pages reuse one upstream fetch and concurrent requests share it.

**Response (abridged):**
```json
{
  "ok": true,
  "version": "1.3.0",
  "count": 10,
  "total": 665,
  "total_unfiltered": 665,
  "total_expired": 0,
  "next_expiry": "2026-11-22T15:15:00.000Z",
  "next_cursor": "MTc5NTM1ODEwMDAwMHx1c2dzLW5jNzUy",
  "summary": { "total": 665, "by_domain": {}, "by_severity": {}, "by_precision": {}, "top_events": [] },
  "sources": [
    { "key": "usgs-day", "status": "ok", "count": 216, "retained": false,
      "precision": "exact", "coverage": "Global earthquakes of every magnitude, last 24 hours",
      "refreshSeconds": 120, "warnings": [] }
  ],
  "data": [
    {
      "id": "usgs-nc75209241", "domain": "disaster", "category": "earthquake", "severity": "medium",
      "title": "M 4.2 - 14km NNE of Ridgecrest, CA",
      "location": { "precision": "exact", "lat": 35.7, "lng": -117.6, "label": "Ridgecrest, CA" },
      "source": "USGS", "timestamp": "2026-02-28T11:43:00Z"
    }
  ]
}
```

### GET /api/v1/summary

```bash
curl https://vgilmap.vercel.app/api/v1/summary
```

Counts by domain, severity and location precision over the **full** filtered dataset (not just one page), the top 5 critical/high events, and per-source health. Accepts the same filters as `/api/v1/events`.

Full spec: [`/openapi.json`](https://vgilmap.vercel.app/openapi.json)

---

## Adding a new data source

1. **Normalizer:** `shared/adapters/your-source.ts` exports `normalizeYourSource(raw): VigilEvent[]` (or `{ events, warnings }`). Pure: no `fetch`, no DOM. Throw if the raw data is unusable as a whole.
2. **Definition:** add an entry to `SOURCE_META` in `shared/pipeline/sources.ts`: key, label, domain, `staleAfterHours`, `refreshSeconds`, default `precision` and a plain-words `coverage`.
3. **Loader:** add the upstream fetch to `api/_lib/sources.ts` (secrets are read here or in a proxy under `api/`, never in the browser).
4. **Test:** add a normalizer test in `tests/` with a real sample of the upstream data.

The app, the public API, Data Health, the legend and the README table pick it up from there. A source that fails shows as *Down* (or *Stale · refresh failed* with its last good data) and never affects the others.

---

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Vite 7 |
| Map | MapLibre GL 5 |
| Map tiles | CartoDB Dark Matter (free, no key) |
| Fonts | Protomaps Noto Sans PBF |
| Deployment | Vercel edge functions + CDN |
| AI | NVIDIA NIM (OpenAI-compatible API) via edge proxy |
| Event concentrations | Welford's algorithm, pure TypeScript |
| Tests | Vitest |

---

## Roadmap

- [x] Economic & labor data sources (ReliefWeb + GDELT Economic)
- [x] Keyword search across events
- [x] Shareable event URLs (`?event=usgs-abc123`)
- [x] Map legend with color swatches + magnitude key
- [x] API documentation page (`/api-docs.html`)
- [ ] API key system + Pro tier (webhooks, 90-day history)
- [ ] Email/SMS alerts for a saved region
- [ ] Historical timeline slider
- [ ] PWA manifest + offline support

---

## Contributing

PRs welcome. Open an issue first for large changes.

```bash
npm run dev        # dev server at localhost:5173
npm run build      # production build
npm run typecheck  # TypeScript check only
npm run lint       # ESLint
```

---

## License

MIT — see [LICENSE](LICENSE).

**Data source licenses:**
- USGS earthquake data: public domain (U.S. Government)
- NASA FIRMS: public domain (U.S. Government)
- NOAA NWS alerts: public domain (U.S. Government)
- GDELT: open data — [GDELT Project terms](https://www.gdeltproject.org/about.html)
- WHO Disease Outbreak News: © World Health Organization
- Have I Been Pwned breach data: © Troy Hunt, CC BY 4.0 (https://haveibeenpwned.com)