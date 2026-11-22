import type { LocationPrecision, VigilEvent } from '../types';
import { isMappable } from '../types';

/** Wording for each precision level (used by the popup, list rows and Data Health). */
export const PRECISION_META: Record<LocationPrecision, { label: string; hint: string }> = {
  exact:   { label: 'Exact location',   hint: 'A measured position (e.g. an earthquake epicentre or a satellite fire detection)' },
  area:    { label: 'Area centre',      hint: 'The centre of an affected area; the event covers more than this point' },
  country: { label: 'Country estimate', hint: 'Placed at the centre of the country named in the report, not where it actually happened' },
  unknown: { label: 'No location',      hint: 'No real place; shown in lists only' },
};

/**
 * Stamp an event with its location precision. Unlocated events are always 'unknown'; otherwise a
 * precision set by the normalizer wins, falling back to the source's default.
 */
export function withPrecision(ev: VigilEvent, sourceDefault: LocationPrecision): VigilEvent {
  const precision: LocationPrecision = !isMappable(ev) ? 'unknown' : ev.location.precision ?? sourceDefault;
  return ev.location.precision === precision ? ev : { ...ev, location: { ...ev.location, precision } };
}
