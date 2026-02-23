# VigilMap 🌍

**The open-source global intelligence platform** — unified real-time monitoring of health, climate, conflict, disasters, economics, labor, and science in one interactive map.

[![GitHub stars](https://img.shields.io/github/stars/yourusername/vigilmap?style=social)](https://github.com/yourusername/vigilmap/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/yourusername/vigilmap/blob/main/CONTRIBUTING.md)

> *What Palantir charges governments millions for — free, transparent, and built for everyone.*

---

## Why VigilMap?

Right now, a doctor in rural Nigeria, a journalist in Southeast Asia, and an aid worker in Sudan all face the same problem: **the data they need exists, but it's scattered across dozens of systems nobody without serious resources can connect.**

Disease outbreak reports are on WHO. Economic stress is in a World Bank PDF. Conflict data is in an ACLED spreadsheet. Wildfire alerts are on NASA. Weather warnings are on NOAA. All public. All free. **Nobody is connecting the dots.**

VigilMap connects them — for everyone, not just governments and corporations.

| Problem | Solution |
|---|---|
| Critical data scattered across 30+ sources | **One unified map and dashboard** |
| No connection between health, climate, conflict signals | **Cross-domain correlation engine** |
| Expensive OSINT tools ($$$) | **100% free & open source** |
| Information overload | **AI-synthesized intelligence briefs** |
| No warning before crises explode | **Anomaly detection across all domains** |

---

## Live Demo

🚧 **Coming soon** — [vigilmap.app](https://vigilmap.app)

---

## What VigilMap Monitors

### 🏥 Public Health
- Disease outbreaks (WHO, ProMED, HealthMap)
- Hospital capacity stress
- Drug shortages (OpenFDA)
- Wastewater surveillance signals (CDC NWSS)

### 🌡️ Climate & Environment
- Wildfire detection via satellite (NASA FIRMS — VIIRS thermal hotspots)
- Air quality alerts (AirNow API)
- Severe weather warnings (NOAA)
- Deforestation alerts (Global Forest Watch)
- Natural disasters (NASA EONET, USGS)

### ⚔️ Conflict & Geopolitics
- Active conflict zones and escalation (ACLED, GDELT)
- Social unrest and protests
- Displacement tracking (UNHCR feeds)
- Geopolitical news events

### 💰 Economic Stress
- Unemployment spikes by region (FRED)
- Housing affordability stress (HUD, Census)
- Food insecurity alerts (USDA)
- Real-time economic indicators (World Bank)

### 🚨 Disasters & Infrastructure
- Earthquakes (USGS real-time)
- Hurricane and storm tracks (NOAA)
- Internet outages (Cloudflare Radar)
- Power grid disruptions (EIA)
- Flood zones (FEMA)

### ✊ Labor & Social
- Strikes and union activity (NLRB, BLS)
- Workplace safety violations (OSHA)
- Worker rights incidents (ILO)

### 🔬 Science & Research
- Emerging research by topic and region (OpenAlex, arXiv)
- Retraction alerts (Retraction Watch)
- Research funding flows (NIH Reporter, NSF)

---

## Key Features

### 🗺️ Interactive Global Map
- All domains on one unified map with toggleable layers
- Smart clustering — markers group at low zoom, expand on zoom in
- 8 regional presets — Global, Americas, Europe, MENA, Asia, Africa, Oceania, Latin America
- Time filtering — 1h, 6h, 24h, 48h, 7d event windows
- Shareable map state via URL parameters

### 🧠 Intelligence Engine
- **Cross-domain correlation** — when health, economic, and conflict signals spike in the same region simultaneously, VigilMap escalates the alert
- **Temporal anomaly detection** — Welford's online algorithm learns what "normal" looks like per region, weekday, and month. Flags genuine deviations, not just high numbers
- **AI-synthesized briefs** — daily regional summaries powered by Groq (Llama 3.1), Redis-cached so identical queries never hit the LLM twice
- **Convergence scoring** — 3+ domain types spiking in the same geographic cell triggers a convergence alert

### 📡 Real-Time Data
- 30+ free public APIs, all normalized into one unified schema
- Tiered update frequency — critical signals (earthquakes, outbreaks) every 5 minutes; background signals (economic data) every 6-24 hours
- Circuit breakers with cooldowns prevent cascading failures
- Intelligence gap reporting — explicitly shows when a data source is stale or down

### 🔔 Alerts & Monitoring
- Custom keyword and region monitors
- Severity tiers — info, low, medium, high, critical
- Slack, email, and webhook integrations (paid tier)

### 🌐 Public API
- Every signal available via clean REST API
- Free tier with generous rate limits
- Developers can build specialized apps on top

---

## How It Works

### The Unified Data Schema

Every event from every source is normalized into one consistent structure:

```typescript
interface VigilEvent {
  id: string;
  timestamp: string;        // ISO 8601
  domain: Domain;           // health | climate | conflict | economic | disaster | labor | science
  category: string;         // earthquake | outbreak | strike | wildfire | etc.
  severity: Severity;       // info | low | medium | high | critical
  title: string;
  description: string;
  location: {
    lat: number;
    lng: number;
    country: string;
    region: string;
    label: string;
  };
  source: string;           // WHO | USGS | ACLED | etc.
  sourceUrl: string;
  confidence: number;       // 0-1
  tags: string[];
  relatedEvents?: string[]; // IDs of correlated events
}
```

This schema is the foundation. Every data adapter outputs this. Every front-end consumes this. Community contributors add new adapters without touching anything else.

### The Intelligence Pipeline

```
Raw API Data
    ↓
Domain Adapter (normalize to VigilEvent schema)
    ↓
Unified Event Store (Supabase + PostGIS)
    ↓
Intelligence Engine
    ├── Anomaly Detection (Welford's algorithm per region/weekday/month)
    ├── Cross-domain Correlation (health + conflict + economic in same area)
    ├── Convergence Scoring (3+ domains spiking in 1°×1° geographic cell)
    └── AI Synthesis (Groq Llama 3.1 — cached in Redis)
    ↓
Public API + Interactive Map
```

### Anomaly Detection

Rather than static thresholds, VigilMap learns what "normal" looks like. Each event type is tracked per region with separate baselines for each weekday and month — because earthquake frequency in the Pacific Ring differs from Central Europe, and military activity patterns differ on weekdays vs weekends.

**Welford's online algorithm** computes streaming mean and variance with a 90-day rolling window stored in Redis. Z-score thresholds:

| Z-Score | Severity | Example |
|---|---|---|
| ≥ 1.5 | Low | Slightly elevated protest activity |
| ≥ 2.0 | Medium | Unusual disease report frequency |
| ≥ 3.0 | High/Critical | Earthquake activity 3x above baseline |

A minimum of 10 historical samples is required before anomalies are reported — preventing false positives during the learning phase.

---

## Architecture

### Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React + TypeScript + Vite | Fast, type-safe, great ecosystem |
| Map | MapLibre GL + deck.gl | Open source, WebGL-powered, no API key needed |
| Backend | Vercel Edge Functions | Serverless, globally distributed, free tier |
| Database | Supabase (Postgres + PostGIS) | Geospatial queries, free tier, open source |
| Cache | Upstash Redis | Cross-user AI deduplication, anomaly baselines |
| AI | Groq (Llama 3.1 8B) | Fast, cheap, reliable |
| Map Tiles | MapTiler / Stadia Maps | Free for open source projects |

### Project Structure

```
vigilmap/
├── src/
│   ├── adapters/          # One file per data source
│   │   ├── usgs.ts        # Earthquakes
│   │   ├── who.ts         # Disease outbreaks
│   │   ├── nasa-firms.ts  # Satellite wildfires
│   │   ├── noaa.ts        # Weather alerts
│   │   ├── gdelt.ts       # News events
│   │   ├── acled.ts       # Conflict data
│   │   ├── fred.ts        # Economic indicators
│   │   └── ...
│   ├── intelligence/      # Analysis engine
│   │   ├── anomaly.ts     # Welford's algorithm
│   │   ├── correlation.ts # Cross-domain correlation
│   │   ├── convergence.ts # Geographic convergence scoring
│   │   └── synthesis.ts   # AI brief generation
│   ├── map/               # Map components
│   │   ├── Globe.tsx
│   │   ├── layers/        # One component per domain layer
│   │   └── controls/
│   ├── api/               # Public API routes
│   ├── types/             # Shared TypeScript types
│   └── utils/
├── api/                   # Vercel Edge Functions
├── data/                  # Static reference data
│   ├── countries.json
│   ├── conflict-zones.json
│   └── strategic-locations.json
├── docs/                  # Documentation
└── public/
```

---

## Quick Start

```bash
# Clone
git clone https://github.com/yourusername/vigilmap.git
cd vigilmap

# Install
npm install

# Run (works without any API keys for basic functionality)
npm run dev
```

Open http://localhost:5173

### Environment Variables (Optional)

For full functionality, add to `.env.local`:

```bash
# AI Synthesis (Groq) — free tier available
GROQ_API_KEY=gsk_xxx

# Cross-user cache (Upstash Redis) — free tier available
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx

# NASA satellite fire detection — free
NASA_FIRMS_API_KEY=xxx

# Map tiles — free for open source
MAPTILER_API_KEY=xxx
```

See [docs/API_KEYS.md](docs/API_KEYS.md) for the full list and how to get each key free.

---

## Data Sources

All data sources used by VigilMap are **free and publicly available**.

| Domain | Source | Update Frequency |
|---|---|---|
| Earthquakes | USGS Earthquake Hazards | Real-time |
| Disease Outbreaks | WHO, ProMED, HealthMap | Hourly |
| Wildfires | NASA FIRMS (VIIRS) | Every 10 minutes |
| Weather Alerts | NOAA | Every 5 minutes |
| News Events | GDELT | Every 15 minutes |
| Conflict Data | ACLED | Daily |
| Economic Indicators | FRED (Federal Reserve) | Daily/Weekly |
| Food Insecurity | USDA, World Food Programme | Weekly |
| Internet Outages | Cloudflare Radar | Real-time |
| Labor Activity | NLRB, BLS, ILO | Daily |
| Research Papers | OpenAlex, arXiv | Hourly |
| Natural Disasters | NASA EONET | Real-time |
| Flood Alerts | FEMA, NOAA | Real-time |
| Air Quality | AirNow, OpenAQ | Hourly |
| Deforestation | Global Forest Watch | Daily |

---

## Who Uses VigilMap

- **Journalists** — spot converging signals before they become stories
- **NGOs & Aid organizations** — see where crises are building before resources are deployed
- **Researchers** — cross-domain data in one unified API instead of 30 separate integrations
- **Public health workers** — early warning across disease, environment, and economic stress
- **Developers** — build specialized applications on top of the public API
- **Curious citizens** — understand the world beyond the algorithm-driven news feed

---

## Contributing

VigilMap is built by the community. The most impactful contribution is **adding a new data adapter** — one file that connects a new data source to the unified schema.

```bash
# Development
npm run dev           # Start dev server
npm run build         # Production build
npm run typecheck     # Type checking
npm run test          # Run tests
```

### Adding a New Data Adapter

Every adapter lives in `src/adapters/` and exports one async function:

```typescript
// src/adapters/your-source.ts
import { VigilEvent } from '../types';

export async function fetchYourSource(): Promise<VigilEvent[]> {
  const raw = await fetch('https://api.yoursource.org/data');
  const data = await raw.json();

  return data.items.map(item => ({
    id: `yoursource-${item.id}`,
    timestamp: item.date,
    domain: 'health',      // or climate, conflict, economic, etc.
    category: 'outbreak',
    severity: 'medium',
    title: item.title,
    description: item.summary,
    location: {
      lat: item.latitude,
      lng: item.longitude,
      country: item.country,
      region: item.region,
      label: item.place_name,
    },
    source: 'Your Source Name',
    sourceUrl: item.url,
    confidence: 0.8,
    tags: [item.type, item.category],
  }));
}
```

That's it. Open a PR and it becomes part of VigilMap.

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

---

## Roadmap

### Phase 1 — Foundation (Current)
- [x] Project setup and unified data schema
- [ ] MapLibre GL globe with basic layers
- [ ] Core adapters: USGS, NASA FIRMS, WHO, NOAA, GDELT
- [ ] Initial GitHub launch

### Phase 2 — Intelligence Engine
- [ ] Anomaly detection (Welford's algorithm)
- [ ] Cross-domain correlation
- [ ] AI-synthesized regional briefs (Groq)
- [ ] Custom alert monitors

### Phase 3 — Public API
- [ ] REST API with rate limiting
- [ ] API documentation
- [ ] SDK for common languages
- [ ] Webhook support

### Phase 4 — Community & Scale
- [ ] Mobile-optimized views
- [ ] Self-hosted Docker image
- [ ] Multi-language support
- [ ] Historical data playback
- [ ] Community-contributed adapters

---

## Supporting VigilMap

VigilMap is free forever for individuals, researchers, journalists, and NGOs. If it helps your work:

- ⭐ **Star this repo** to help others discover it
- 🐛 **Report issues** to help improve the platform
- 🔧 **Contribute** a new data adapter
- 💬 **Share** with colleagues who need better global awareness
- 💖 **Sponsor** via [GitHub Sponsors](https://github.com/sponsors/yourusername) to keep the servers running

For organizations needing hosted deployment, custom adapters, or dedicated support — see [docs/ENTERPRISE.md](docs/ENTERPRISE.md).

---

## License

MIT License — see [LICENSE](LICENSE) for details.

Free to use, modify, and self-host forever.

---

## Author

Built with the belief that global intelligence shouldn't be a privilege.

**Contributions welcome from anyone, anywhere.**

---

*VigilMap — Watch the world. Help the people in it.*
