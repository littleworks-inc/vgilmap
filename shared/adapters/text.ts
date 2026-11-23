/**
 * Small text rules shared by the headline classifier and the incident fact rows, so both judge
 * negation and wording the same way.
 */

/** Typographic quotes and apostrophes to plain ASCII, so patterns written with ' also match ’. */
export function plainQuotes(s: string): string {
  return s.replace(/[‘’‛′]/g, "'").replace(/[“”„]/g, '"');
}

/** Negation or denial ("did not", "didn't", "denies", "no evidence"). Apply to quote-normalised text. */
export const NEGATED = /\b(?:not|no|never|denies|denied|unaffected|without|rejects|refutes|disputes|didn'?t|doesn'?t|wasn'?t|isn'?t|hasn'?t|haven'?t|won'?t|cannot|can'?t)\b/i;

/**
 * Shorten text for display without cutting a word in half: whitespace is tidied, the cut falls at the
 * last sentence end (or else the last space) within `max`, and an ellipsis marks that something was left out.
 */
export function clip(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentence >= max * 0.5) return head.slice(0, sentence + 1);
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[\s,;:—-]+$/, '')}…`;
}
