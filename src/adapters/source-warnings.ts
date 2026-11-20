/**
 * Partial-failure channel between data adapters and the Data Health panel.
 *
 * An adapter that fails completely just throws. But some adapters combine several upstream
 * feeds (e.g. GDELT + RSS, or three NASA endpoints), and one can fail while the others work.
 * That is not an error (there is data) and not fully healthy either, so the adapter records a
 * warning here and the app shows the source as "degraded" with the message.
 *
 * Keys are the adapter registry keys in App.tsx.
 */
const warnings = new Map<string, string[]>();

export function clearWarnings(key: string): void {
  warnings.delete(key);
}

export function addWarning(key: string, message: string): void {
  const existing = warnings.get(key) ?? [];
  // Loads can overlap (dev StrictMode runs effects twice; a slow refresh can still be running),
  // so the same warning may be reported more than once. Keep each message once.
  if (!existing.includes(message)) warnings.set(key, [...existing, message]);
}

export function getWarnings(key: string): string[] {
  return warnings.get(key) ?? [];
}
