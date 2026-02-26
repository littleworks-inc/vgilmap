import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  build: {
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks: {
          'maplibre': ['maplibre-gl'],
          'deckgl': ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/mapbox'],
        },
      },
    },
  },

  server: {
    port: 5173,
    open: false,

    headers: {
      // MapLibre GL uses new Function() internally for WebGL shader compilation.
      // Vite 7 adds a strict CSP by default that blocks eval/new Function — this
      // relaxes it just enough for the map to render. 'unsafe-eval' is dev-only;
      // production deployments should use a worker-based shader approach instead.
      //
      // blob: in worker-src is required for MapLibre's web worker tile parsing.
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval'",   // MapLibre GL shader compilation
        "worker-src blob: 'self'",            // MapLibre tile-parsing web workers
        "style-src 'self' 'unsafe-inline'",  // MapLibre injects inline styles
        "img-src 'self' data: blob: https:", // map tiles + data URIs
        "connect-src 'self' https: blob:",   // API fetches + tile fetches
        "font-src 'self' data:",             // map label fonts
      ].join('; '),
    },

    proxy: {
      // ── NOAA NWS ──────────────────────────────────────────────────────────
      // api.weather.gov requires a User-Agent for identification.
      // Browsers block setting User-Agent in fetch(), so we proxy through
      // Vite's Node.js dev server, which can inject the header freely.
      //
      // In production (Vercel), replace with an Edge Function at /api/noaa.
      '/api/noaa': {
        target: 'https://api.weather.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/noaa/, ''),
        // NWS required format: "(AppName, contact@email.com)"
        // Do NOT include Accept here — let NWS use its default content negotiation.
        headers: {
          'User-Agent': '(VigilMap, contact@vigilmap.app)',
        },
      },

    },
  },
})
