/**
 * briefs.ts — AI-powered global intelligence briefs via OpenRouter
 *
 * Strategy to stay within free-tier rate limits:
 *   - Payload trimmed to top 8 events (title + severity + location only)
 *   - 2-second delay between model attempts
 *   - 2-model cascade (smallest reliable free models)
 *   - Local fallback summary when all AI models fail
 *
 * Model cascade (both free):
 *   1. meta-llama/llama-3.1-8b-instruct:free  — reliable, small, usually available
 *   2. mistralai/mistral-7b-instruct:free      — second option
 *
 * API key: VITE_OPENROUTER_API_KEY in .env.local
 */

import type { VigilEvent } from '../types';
import { SEVERITY_ORDER } from '../types';

// ─── Types ─────────────────────────────────────────────────

export type BriefSource = 'ai' | 'local';

export interface BriefResult {
  brief: string;
  source: BriefSource;
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  max_tokens?: number;
  temperature?: number;
}

interface OpenRouterResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  error?: { message: string; code?: number };
}

// ─── Constants ─────────────────────────────────────────────

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TOP_N = 8;
const DELAY_MS = 2000;

// Model cascade — ordered by preference (fastest/most-available first).
// OpenAI OSS models support the standard system role and are well-served on OR.
// Gemma models need messages normalised (no system role — see normalizeMessages).
const MODEL_CASCADE = [
  'google/gemma-3-12b-it:free',               // ✅ reliably working — try first
  'openai/gpt-oss-20b:free',                  // unlock at openrouter.ai/settings/privacy
  'openai/gpt-oss-120b:free',                 // unlock at openrouter.ai/settings/privacy
  'meta-llama/llama-3.2-3b-instruct:free',   // LLaMA fallback
  'meta-llama/llama-3.3-70b-instruct:free',  // last resort
] as const;

// Models that don't support the OpenAI-style `system` role.
// For these we merge the system prompt into the first user message.
const NO_SYSTEM_ROLE = new Set(['google/gemma-3-12b-it:free', 'google/gemma-3-27b-it:free']);

const NO_KEY_MESSAGE = 'Add VITE_OPENROUTER_API_KEY to .env.local to enable AI briefs.\nGet a free key at openrouter.ai';

// ─── Helpers ───────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Gemma models on OpenRouter reject requests that contain a `system` role
 * message with 400 "Provider returned error". Merge the system prompt into
 * the first user message so the request works across all providers.
 */
function normalizeMessages(
  model: string,
  messages: OpenRouterMessage[]
): OpenRouterMessage[] {
  if (!NO_SYSTEM_ROLE.has(model)) return messages;

  const systemMsg = messages.find(m => m.role === 'system');
  if (!systemMsg) return messages;

  const rest = messages.filter(m => m.role !== 'system');
  const firstUser = rest.find(m => m.role === 'user');
  if (!firstUser) return rest;

  // Prepend system text to the first user message
  return rest.map(m =>
    m === firstUser
      ? { ...m, content: `${systemMsg.content}\n\n${m.content}` }
      : m
  );
}

// ─── Local fallback summary ─────────────────────────────────

/**
 * Produces a plain-text summary from the event list without any AI call.
 * Used when all OpenRouter models are unavailable.
 */
function localSummary(events: VigilEvent[]): string {
  if (events.length === 0) return 'No active events to summarise.';

  // Count by domain
  const domainCounts: Record<string, number> = {};
  for (const ev of events) {
    domainCounts[ev.domain] = (domainCounts[ev.domain] ?? 0) + 1;
  }
  const domainLine = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => `${n} ${d}`)
    .join(', ');

  // Top 3 critical/high events
  const urgent = [...events]
    .filter(e => e.severity === 'critical' || e.severity === 'high')
    .sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity])
    .slice(0, 3);

  const lines = [`${events.length} active events across ${domainLine}.`];
  if (urgent.length > 0) {
    lines.push(
      'Most significant: ' +
        urgent.map(e => `${e.title} (${e.location.label})`).join('; ') +
        '.'
    );
  }

  return lines.join(' ');
}

// ─── Single-model attempt ──────────────────────────────────

/**
 * Try one model. Returns the brief text on success.
 *
 * Retryable (try next model):
 *   429 — rate-limited / at capacity
 *   400/5xx with "Provider returned error" — upstream provider is down
 *
 * Non-retryable (stop cascade, same key will fail everywhere):
 *   401 / 403 — bad or missing API key
 */
async function tryModel(
  model: string,
  messages: OpenRouterMessage[],
  apiKey: string
): Promise<string> {
  const body: OpenRouterRequest = {
    model,
    messages: normalizeMessages(model, messages),
    max_tokens: 160,
    temperature: 0.4,
  };

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer':  'https://github.com/amareswer/vgilmap',
      'X-Title':       'VigilMap',
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  const data: OpenRouterResponse = await response.json();

  // 401 / 403 — auth failure: no point trying other models with the same key
  if (response.status === 401 || response.status === 403) {
    const msg = data.error?.message ?? `HTTP ${response.status} auth error`;
    console.error(`[briefs] ${model} auth error (stopping cascade):`, msg);
    throw Object.assign(new Error(msg), { retryable: false });
  }

  // 429 — rate-limited / at capacity → try next model after delay
  if (response.status === 429) {
    console.warn(`[briefs] ${model} rate-limited (429), trying next model…`);
    throw Object.assign(new Error('rate-limited'), { retryable: true });
  }

  // Any other error — treat as retryable so the cascade continues.
  if (!response.ok || data.error) {
    const msg = data.error?.message ?? `HTTP ${response.status}`;
    console.warn(`[briefs] ${model} failed (${response.status}: ${msg}), trying next model…`);
    throw Object.assign(new Error(msg), { retryable: true });
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    console.error(`[briefs] ${model} returned empty content`);
    throw Object.assign(new Error('empty response'), { retryable: false });
  }

  return content;
}

// ─── Main export ───────────────────────────────────────────

/**
 * Generate a brief summarising the top events.
 *
 * Returns { brief, source } where source is 'ai' or 'local'.
 *
 * @param events  Full filtered event list (trimmed to top 8 by severity)
 * @param context Label for the region/scope, e.g. "Global" or "Southeast Asia"
 */
export async function generateBrief(
  events: VigilEvent[],
  context: string
): Promise<BriefResult> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined;

  if (!apiKey || apiKey.trim() === '') {
    return { brief: NO_KEY_MESSAGE, source: 'local' };
  }

  // Trim to top 8 events, 3 fields only — keeps prompt small and fast
  const top8 = [...events]
    .sort((a, b) => {
      const severityDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })
    .slice(0, TOP_N)
    .map(e => ({
      title:    e.title,
      severity: e.severity,
      location: e.location.label,
    }));

  const messages: OpenRouterMessage[] = [
    {
      role: 'system',
      content:
        'You are a concise global intelligence analyst. ' +
        'Summarize current events in 3-4 sentences. ' +
        'Focus on significant patterns, geographic concentrations, and what warrants monitoring. ' +
        'Be factual and direct. No bullet points.',
    },
    {
      role: 'user',
      content: `Summarize these ${top8.length} active events in ${context}: ${JSON.stringify(top8)}`,
    },
  ];

  // Walk the cascade — wait 2 s between attempts, stop on success or hard error
  for (let i = 0; i < MODEL_CASCADE.length; i++) {
    const model = MODEL_CASCADE[i];

    if (i > 0) {
      await delay(DELAY_MS);
    }

    try {
      const brief = await tryModel(model, messages, apiKey);
      if (i > 0) {
        console.info(`[briefs] Used fallback model: ${model}`);
      }
      return { brief, source: 'ai' };
    } catch (err) {
      const retryable = (err as { retryable?: boolean }).retryable;
      if (!retryable) {
        // Hard error (auth) — fall through to local summary
        break;
      }
      // Retryable — continue to next model
    }
  }

  // All models exhausted → local fallback
  console.warn('[briefs] All AI models unavailable, using local summary');
  return { brief: localSummary(events), source: 'local' };
}
