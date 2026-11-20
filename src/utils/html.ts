/**
 * HTML safety helpers.
 *
 * Event text comes from third-party feeds (news headlines, ransomware victim names, WHO titles,
 * breach names…). Anywhere it is placed into an HTML *string* (e.g. MapLibre popups via setHTML)
 * it must be escaped, otherwise a hostile or compromised feed could inject script into the page.
 * (React text children are escaped automatically; this is for hand-built HTML only.)
 */
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ENTITIES[c]);
}

/** Returns the URL, escaped for an attribute, only if it is http(s); '' for javascript:, data:, etc. */
export function safeHttpUrl(value: unknown): string {
  try {
    const u = new URL(String(value));
    return u.protocol === 'http:' || u.protocol === 'https:' ? escapeHtml(u.href) : '';
  } catch {
    return '';
  }
}
