import type { EvidenceKind, VigilEvent } from '../types';
import { EVIDENCE_META, EVIDENCE_ORDER } from '../types';
import { safeHttpUrl } from '../utils/html';
import type { IncidentSummary } from '../../shared/pipeline/incidents';
import { incidentOf } from '../utils/incident';

/** Who is saying it happened: attacker claim, news report, organization-confirmed, ... */
export function EvidenceBadge({ kind, compact }: { kind: EvidenceKind; compact?: boolean }) {
  const m = EVIDENCE_META[kind];
  return (
    <span
      title={`${m.label}: ${m.hint}`}
      style={{
        fontSize: compact ? '9px' : '10px', padding: compact ? '0 5px' : '0 6px', borderRadius: '8px', whiteSpace: 'nowrap',
        border: `1px solid ${m.color}66`, background: `${m.color}14`, color: m.color, fontWeight: 600,
      }}
    >
      {m.label}
    </span>
  );
}

/** Evidence badge for a single (ungrouped) cyber report. Incident rows show their own set instead. */
export function EventEvidence({ event }: { event: VigilEvent }) {
  if (!event.evidence || incidentOf(event)) return null;
  return <EvidenceBadge kind={event.evidence} />;
}

/** "3 reports" plus the distinct kinds of evidence behind them. */
export function IncidentChip({ incident }: { incident: IncidentSummary }) {
  return (
    <>
      <span
        title={`${incident.reportCount} reports about this incident, from ${incident.sources.join(', ')}`}
        style={{ fontSize: '10px', padding: '0 6px', borderRadius: '8px', border: '1px solid #475569', color: '#cbd5e1', background: '#1e293b', whiteSpace: 'nowrap', fontWeight: 600 }}
      >
        {incident.reportCount} reports
      </span>
      {incident.evidence.map(k => <EvidenceBadge key={k} kind={k} compact />)}
    </>
  );
}

/** Every report behind an incident, oldest first, each with its own evidence label and link. */
export function IncidentReports({ incident }: { incident: IncidentSummary }) {
  const reports = [...incident.reports].sort((a, b) => EVIDENCE_ORDER.indexOf(a.evidence ?? 'claim') - EVIDENCE_ORDER.indexOf(b.evidence ?? 'claim') || a.timestamp.localeCompare(b.timestamp));
  return (
    <div style={{ marginTop: '8px', fontSize: '12px', color: '#cbd5e1', lineHeight: 1.45, whiteSpace: 'normal', cursor: 'default' }} onClick={e => e.stopPropagation()}>
      <div style={{ fontSize: '11px', color: '#8a99ae', marginBottom: '4px' }}>
        {incident.org} · first reported {new Date(incident.firstSeen).toLocaleDateString()}
        {incident.claimedBy ? ` · claimed by ${incident.claimedBy}` : ''}
      </div>
      {reports.map(r => {
        const href = safeHttpUrl(r.url);
        return (
          <div key={r.id} style={{ display: 'flex', gap: '6px', alignItems: 'baseline', flexWrap: 'wrap', padding: '3px 0', borderTop: '1px solid #1e293b' }}>
            {r.evidence && <EvidenceBadge kind={r.evidence} compact />}
            <span style={{ color: '#94a3b8' }}>{r.source}</span>
            <span style={{ color: '#7d8ba1', fontSize: '11px' }}>{new Date(r.timestamp).toLocaleDateString()}</span>
            {href && <a href={href} target="_blank" rel="noopener noreferrer" title="Read the original report (opens in a new tab)" onClick={e => e.stopPropagation()} style={{ color: '#60a5fa', fontSize: '11px' }}>read ↗</a>}
          </div>
        );
      })}
    </div>
  );
}
