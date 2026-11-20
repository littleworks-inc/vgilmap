import type { VigilEvent } from '../types';
import { safeHttpUrl } from '../utils/html';

/**
 * Link to an event's original report.
 *
 * An event with no map location never gets a map popup, so this link (and the summary shown when
 * its list row is opened) is the only way to reach what the event is about. Only http(s) URLs are
 * linked; clicks are kept from also toggling the list row that contains the link.
 */
export function SourceLink({ event, label }: { event: VigilEvent; label?: string }) {
  const href = safeHttpUrl(event.sourceUrl);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open the original report on ${event.source}`}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      style={{ color: '#60a5fa', textDecoration: 'none', whiteSpace: 'nowrap' }}
    >
      {label ?? 'source ↗'}
    </a>
  );
}
