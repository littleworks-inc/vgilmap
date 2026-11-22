import type { VigilEvent } from '../types';
import type { IncidentSummary } from '../../shared/pipeline/incidents';

/** The incident a row represents, when it stands for several reports (stamped by collapseIncidents). */
export function incidentOf(ev: VigilEvent): IncidentSummary | undefined {
  return ev.metadata?.incident as IncidentSummary | undefined;
}
