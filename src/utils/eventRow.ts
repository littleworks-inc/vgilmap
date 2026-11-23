/** Hover text for an event row in the list, matching what clicking it actually does. */
export function eventRowTitle({ unmapped, incident, expanded }: { unmapped: boolean; incident: boolean; expanded: boolean }): string {
  if (unmapped) return expanded ? 'Hide the details' : 'Show the details (this event has no map location)';
  if (incident) return expanded ? 'Show on the globe and hide its reports' : 'Show on the globe and list the reports behind it';
  return 'Show this event on the globe';
}
