/**
 * AI brief proxy — Vercel Edge Function (NVIDIA NIM, OpenAI-compatible API).
 *
 * The browser sends a trimmed event list; this function holds NVIDIA_API_KEY
 * (server-side only — never ship it in the client bundle) and walks a model
 * cascade. On total failure it returns 502 and the client uses its local summary.
 *
 * POST /api/brief  { events: [{title, severity, location}], context?: string }
 *   → { brief: string, model: string }
 */
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

// Ordered by faithfulness to the input, then speed. Tested 2026-11:
//   gemma-4-31b-it       ~3s, no hidden reasoning, stayed factual
//   minimax-m3.1-flash   ~4s, needs thinking off
//   nemotron lightning   ~1s, needs thinking off, tends to embellish → last resort
const MODELS: Array<{ id: string; noThinking?: boolean }> = [
  { id: 'google/gemma-4-31b-it' },
  { id: 'minimaxai/minimax-m3.1-flash', noThinking: true },
  { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', noThinking: true },
];

const MODEL_TIMEOUT_MS = 8_000; // 3 models x 8s stays under the client's 30s timeout
const MAX_EVENTS = 8;
const MAX_FIELD = 160;

const SYSTEM_PROMPT =
  'You are a concise global intelligence analyst. ' +
  'Summarize the events in 3-4 sentences. ' +
  'Focus on significant patterns, geographic concentrations, and what warrants monitoring. ' +
  'Use ONLY facts present in the input: do not infer damage, casualties, causes or impacts that are not stated. ' +
  'Be factual and direct. No bullet points.';

// ── Best-effort per-IP limit ───────────────────────────────
// In-memory, so it is per edge instance and resets on cold start. It blunts casual
// abuse of your NVIDIA credits; for a hard limit, back this with Redis.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // bound memory
  return recent.length > MAX_PER_WINDOW;
}

// ── Input validation ───────────────────────────────────────

interface BriefEvent { title: string; severity: string; location: string }

function clean(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').slice(0, MAX_FIELD) : '';
}

function parseInput(body: unknown): { events: BriefEvent[]; context: string } | null {
  if (!body || typeof body !== 'object') return null;
  const { events, context } = body as { events?: unknown; context?: unknown };
  if (!Array.isArray(events) || events.length === 0) return null;
  const list = events.slice(0, MAX_EVENTS).map(e => {
    const o = (e ?? {}) as Record<string, unknown>;
    return { title: clean(o.title), severity: clean(o.severity), location: clean(o.location) };
  }).filter(e => e.title);
  if (list.length === 0) return null;
  return { events: list, context: clean(context) || 'Global' };
}

// ── Model call ─────────────────────────────────────────────

async function callModel(
  model: { id: string; noThinking?: boolean },
  userPrompt: string,
  key: string,
): Promise<string> {
  const res = await fetch(NVIDIA_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    body: JSON.stringify({
      model: model.id,
      max_tokens: 300,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      ...(model.noThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`${model.id}: HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${model.id}: empty content`);
  return text;
}

// ── Handler ────────────────────────────────────────────────

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return respond({ error: 'POST only' }, 405);

  const key = process.env.NVIDIA_API_KEY;
  if (!key) return respond({ error: 'NVIDIA_API_KEY not configured' }, 503);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (limited(ip)) return respond({ error: 'rate limited' }, 429);

  let input;
  try { input = parseInput(await req.json()); } catch { input = null; }
  if (!input) return respond({ error: 'expected { events: [{title, severity, location}] }' }, 400);

  const userPrompt = `Summarize these ${input.events.length} active events in ${input.context}: ${JSON.stringify(input.events)}`;

  for (const model of MODELS) {
    try {
      const brief = await callModel(model, userPrompt, key);
      return respond({ brief, model: model.id });
    } catch (err) {
      console.warn('[brief]', err instanceof Error ? err.message : err);
    }
  }
  return respond({ error: 'all models unavailable' }, 502);
}
