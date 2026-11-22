import type { VigilEvent } from '../shared/types';
import type { SourceLoader } from '../shared/pipeline/engine';
import type { SourceMeta } from '../shared/pipeline/sources';
import type { NormalizeResult } from '../shared/adapters/result';

export function ev(id: string, over: Partial<VigilEvent> = {}): VigilEvent {
  return {
    id, timestamp: new Date(Date.UTC(2026, 10, 20) - Number(id.replace(/\D/g, '') || 0) * 1000).toISOString(),
    domain: 'disaster', category: 'earthquake', severity: 'medium', title: `Event ${id}`, description: '',
    location: { lat: 10, lng: 20, country: 'XX', region: '', label: 'Somewhere' },
    source: 'Test', sourceUrl: 'https://example.com', confidence: 0.9, tags: [], ...over,
  };
}

export function meta(key: string, over: Partial<SourceMeta> = {}): SourceMeta {
  return { key, label: key.toUpperCase(), domain: 'disaster', staleAfterHours: 24 * 365, refreshSeconds: 60, precision: 'exact', coverage: 'test', ...over };
}

/** A loader whose behaviour the test controls from outside. */
export function loader(key: string, impl: () => Promise<NormalizeResult> | NormalizeResult, over: Partial<SourceMeta> = {}): SourceLoader {
  return { meta: meta(key, over), load: async () => impl() };
}

export const NOW = Date.UTC(2026, 10, 20, 12);
