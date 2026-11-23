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
