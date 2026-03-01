# 🌍 VigilMap

**Open-source global intelligence platform** — real-time monitoring of earthquakes, wildfires, weather alerts, conflict, and disease outbreaks on an interactive 3D globe.

[![Live Demo](https://img.shields.io/badge/demo-live-22c55e?style=flat-square)](https://vgilmap.vercel.app)
[![MIT License](https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square)](LICENSE)
[![Deploy with Vercel](https://img.shields.io/badge/deploy-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com/new/clone?repository-url=https://github.com/littleworks-inc/vgilmap)

---

## What it does

VigilMap aggregates **5 real-time data sources** into a single dark-mode globe. Events are color-coded by domain, clustered at low zoom, and scored by an anomaly detection engine that surfaces statistically unusual concentrations.

| Domain | Source | Update Freq |
|--------|--------|-------------|
| 🌋 Earthquakes | USGS Earthquake Hazards | Every 5 min |
| 🔥 Wildfires | NASA FIRMS (VIIRS satellite) | Every 3 hrs |
| 🌩 Weather alerts | NOAA National Weather Service | Live |
| ⚔️ Conflict | GDELT Doc API + BBC/DW/Guardian RSS | Every 3 min |
| 🏥 Disease outbreaks | WHO Disease Outbreak News | Daily |

---

## Features

- **Interactive globe** — MapLibre GL, CartoDB Dark Matter tiles, cluster expansion on zoom
- **Anomaly detection** — Welford's online algorithm finds statistically unusual event concentrations, no ML needed
- **AI World Brief** — OpenRouter Llama summarizes the top 8 events into a concise intelligence brief
- **Live ticker** — scrolling event feed at the bottom of the map
- **Mobile responsive** — full-screen map with swipeable bottom drawer on phones
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
cd vigilmap
npm install
cp .env.example .env   # add your API keys (optional)
npm run dev
```

Open [localhost:5173](http://localhost:5173).

### Environment variables

| Variable | Required | Where to get it |
|----------|----------|-----------------|
| `VITE_OPENROUTER_API_KEY` | Optional | [openrouter.ai/keys](https://openrouter.ai/keys) — free tier available |
| `VITE_NASA_FIRMS_API_KEY` | Optional | [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/api/map_key/) — free |

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
src/
├── adapters/                    # One file per data source → VigilEvent[]
│   ├── usgs.ts                  # USGS 24h earthquake feed
│   ├── usgs-significant-week.ts # USGS significant earthquakes (7 days)
│   ├── nasa-firms.ts            # NASA VIIRS wildfire hotspots
│   ├── noaa.ts                  # NOAA NWS active weather alerts
│   ├── gdelt.ts                 # Conflict: GDELT + news RSS (via edge proxies)
│   └── who.ts                   # WHO Disease Outbreak News RSS
├── intelligence/
│   └── anomaly.ts               # Welford online algorithm — no ML, pure math
├── components/
│   ├── Sidebar.tsx              # Event list, AI brief, anomaly panel (desktop)
│   ├── MobileDrawer.tsx         # Swipeable bottom sheet (mobile)
│   ├── LiveTicker.tsx           # Scrolling event ticker
│   ├── AnimatedCount.tsx        # Count-up animation on data load
│   ├── IntelBrief.tsx           # OpenRouter AI world brief
│   ├── AnomalyPanel.tsx         # Anomaly signal cards
│   └── DomainFilter.tsx         # Domain toggle bar
├── map/
│   └── Globe.tsx                # MapLibre GL map, clusters, popups, idle rotation
├── hooks/
│   └── useIsMobile.ts
└── types/index.ts               # VigilEvent unified schema

api/                             # Vercel edge functions — server-side proxies
├── gdelt.ts                     # GDELT proxy with 3-timespan retry logic
├── conflict-rss.ts              # BBC / DW / Guardian RSS proxy
├── noaa.ts                      # NOAA proxy (NWS requires User-Agent header)
├── gdelt-health.ts              # GDELT health news proxy
└── v1/
    ├── events.ts                # Public REST API — all events with filtering
    └── summary.ts               # Public REST API — counts by domain/severity
```

### Unified event schema

Every adapter normalizes its source data into `VigilEvent`:

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
    lat: number
    lng: number
    country: string
    region: string
    label: string
  }
  source: string           // 'USGS' | 'NASA FIRMS' | 'WHO' | ...
  sourceUrl: string
  confidence: number       // 0–1
  tags: string[]
  metadata?: Record<string, unknown>
}
```

### How anomaly detection works

`src/intelligence/anomaly.ts` runs entirely in the browser with zero external dependencies:

1. Groups events by domain + 10°×10° geographic cell
2. Runs **Welford's online algorithm** to compute rolling mean + stddev per domain
3. Z-scores each cell: `z = (count - mean) / stddev`
4. Returns signals above threshold, labeled in plain English: Mild / Elevated / Extreme

---

## REST API

Free to use, no API key required.

### GET /api/v1/events

```bash
# All events
curl https://vgilmap.vercel.app/api/v1/events

# Filtered
curl "https://vgilmap.vercel.app/api/v1/events?domain=conflict,health&severity=high&limit=20"

# Since a specific time
curl "https://vgilmap.vercel.app/api/v1/events?since=2026-02-28T00:00:00Z"
```

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `domain` | string | Comma-separated: `disaster`, `climate`, `health`, `conflict`, `economic`, `labor`, `science` |
| `severity` | string | Minimum level: `info`, `low`, `medium`, `high`, `critical` |
| `limit` | integer | Max results (default + max: 100) |
| `since` | ISO datetime | Only events after this timestamp |

**Response:**
```json
{
  "ok": true,
  "count": 47,
  "total": 312,
  "generated": "2026-02-28T12:00:00.000Z",
  "version": "1.0.0",
  "data": [
    {
      "id": "usgs-nc75209241",
      "domain": "disaster",
      "category": "earthquake",
      "severity": "medium",
      "title": "M 4.2 - 14km NNE of Ridgecrest, CA",
      "location": { "lat": 35.7, "lng": -117.6, "label": "Ridgecrest, CA" },
      "source": "USGS",
      "timestamp": "2026-02-28T11:43:00Z"
    }
  ]
}
```

### GET /api/v1/summary

```bash
curl https://vgilmap.vercel.app/api/v1/summary
```

Returns event counts by domain and severity, plus the top 5 critical/high events.

Full spec: [`/openapi.json`](https://vgilmap.vercel.app/openapi.json)

---

## Adding a new data source

1. Create `src/adapters/your-source.ts` and export `fetchYourSource(): Promise<VigilEvent[]>`
2. Add it to the `ADAPTERS` array in `src/App.tsx`
3. If the source blocks browser CORS requests, add a proxy at `api/your-source.ts`

The app handles adapter failures gracefully — if one throws, the rest keep running.

---

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Vite 7 |
| Map | MapLibre GL 5 |
| Map tiles | CartoDB Dark Matter (free, no key) |
| Fonts | Protomaps Noto Sans PBF |
| Deployment | Vercel edge functions + CDN |
| AI | OpenRouter — Llama 3.1 8B free tier |
| Anomaly | Welford's algorithm, pure TypeScript |

---

## Roadmap

- [ ] Economic & labor data sources (World Bank, ILO, BLS)
- [ ] Keyword search across events
- [ ] Shareable event URLs (`?event=usgs-abc123`)
- [ ] API key system + Pro tier (webhooks, 90-day history)
- [ ] Email/SMS alerts for a saved region
- [ ] Historical timeline slider

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
- WHO RSS feeds: © World Health Organization