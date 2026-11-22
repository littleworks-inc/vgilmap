import type { VigilEvent } from '../types';
import { isMappable } from '../types';
import { PRECISION_META } from '../../shared/pipeline/precision';

const SHORT = { area: '≈ area', country: '≈ country' } as const;

/**
 * Marks a mapped event whose position is an estimate (country centre or area centre), so a dot
 * on the globe is never read as "this happened exactly here". Exact positions get no badge, and
 * unlocated events already carry the "no map location" marker.
 */
export function PrecisionBadge({ event }: { event: VigilEvent }) {
  const p = event.location.precision;
  if (!isMappable(event) || (p !== 'area' && p !== 'country')) return null;
  return (
    <span
      title={`${PRECISION_META[p].label}: ${PRECISION_META[p].hint}`}
      style={{ fontSize: '10px', padding: '0 6px', borderRadius: '8px', border: '1px dashed #334155', color: '#8a99ae', whiteSpace: 'nowrap' }}
    >
      {SHORT[p]}
    </span>
  );
}
