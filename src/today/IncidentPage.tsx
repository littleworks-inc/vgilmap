import { useState } from 'react';
import type { EvidenceKind, VigilEvent } from '../types';
import { EVIDENCE_META, isMappable } from '../types';
import { safeHttpUrl } from '../utils/html';
import { PRECISION_META } from '../../shared/pipeline/precision';
import { incidentFacts, understanding } from './briefing';
import type { BriefCard, Fact } from './briefing';

/** Evidence label in the Today palette (colours come from the theme, so contrast holds in light and dark). */
export function Ev({ kind }: { kind: EvidenceKind | null }) {
  if (!kind) return null;
  return <span className={`ev ev-${kind}`} title={EVIDENCE_META[kind].hint}>{EVIDENCE_META[kind].label}</span>;
}

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const day = (iso: string) => new Date(iso).toLocaleDateString([], { dateStyle: 'medium' });

function Source({ url, source }: { url: string; source: string }) {
  const href = safeHttpUrl(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{source} ↗</a> : <span>{source}</span>;
}

function FactRow({ fact }: { fact: Fact }) {
  return (
    <div className={`fact ${fact.established ? '' : 'unknown'}`}>
      <div className="fact-q">{fact.question}</div>
      <p className="fact-a">{fact.answer}</p>
      {fact.support.length > 0 && (
        <div className="support">
          {fact.support.map(s => (
            <span key={s.url + s.timestamp} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Ev kind={s.evidence} /><Source url={s.url} source={s.source} /><span className="mono">{day(s.timestamp)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface PageProps {
  card: BriefCard;
  eventsById: ReadonlyMap<string, VigilEvent>;
  lastVisitAt?: number;
  onBack: () => void;
  onShowOnMap: (ev: VigilEvent) => void;
}

/**
 * One incident, in a fixed reading order: current understanding, what changed, evidence, unknowns,
 * location. Facts are separate rows, each with its own supporting reports, so "confirmed intrusion"
 * and "unverified theft claim" are never flattened into one badge.
 */
export function IncidentPage({ card, eventsById, lastVisitAt, onBack, onShowOnMap }: PageProps) {
  const [history, setHistory] = useState(false);
  const { incident, event } = card;
  const facts = incident ? incidentFacts(incident, eventsById) : [];
  const known = facts.filter(f => f.established);
  const unknown = facts.filter(f => !f.established);
  const precision = event.location.precision;
  const mappable = isMappable(event);

  return (
    <article className="pg" aria-label={card.headline}>
      <button className="pg-back" onClick={onBack}>← Back to Today</button>
      <h1>{card.headline}</h1>
      <p className="pg-where">
        {card.place} · reported <time className="mono" dateTime={card.published} title={when(card.published)}>{when(card.published)}</time>
        {card.occurred && <> · happened <span className="mono">{day(card.occurred)}</span></>}
      </p>

      <section aria-labelledby="pg-now">
        <h2 id="pg-now">Current understanding</h2>
        {incident ? (
          <>
            <p className="pg-lead">{understanding(incident)}</p>
            {known.map(f => <FactRow key={f.id} fact={f} />)}
          </>
        ) : (
          <p className="pg-lead">{event.description || event.title}</p>
        )}
      </section>

      <section aria-labelledby="pg-changed">
        <h2 id="pg-changed">What changed</h2>
        <p style={{ margin: 0 }}>{card.change.text}{lastVisitAt && card.change.kind !== 'first-visit' ? <span className="mono"> · last visit {when(new Date(lastVisitAt).toISOString())}</span> : null}</p>
        {card.note && <p className="card-note">{card.note}</p>}
        {incident && (
          <>
            <button className="pg-toggle" style={{ marginTop: 8 }} onClick={() => setHistory(h => !h)} aria-expanded={history}>
              {history ? 'Hide full history' : 'Full history'}
            </button>
            {history && (
              <ol className="timeline">
                {incident.reports.map(r => (
                  <li key={r.id}>
                    <span className="mono">{when(r.timestamp)}</span> <Ev kind={r.evidence} /> {r.source}
                    {r.occurredAt && <span className="mono"> · event dated {day(r.occurredAt)}</span>}
                  </li>
                ))}
              </ol>
            )}
            <p className="card-note">This history lists when each report appeared. Edits to a report, and corrections, are not tracked yet.</p>
          </>
        )}
      </section>

      <section aria-labelledby="pg-evidence">
        <h2 id="pg-evidence">Evidence</h2>
        {incident ? incident.reports.map(r => (
          <div className="report" key={r.id}>
            <div className="report-head"><Ev kind={r.evidence} /><Source url={r.url} source={r.source} /><span className="mono">published {day(r.timestamp)}</span></div>
            <p className="report-title">{r.title}</p>
          </div>
        )) : (
          <div className="report">
            <div className="report-head"><Ev kind={event.evidence ?? null} /><Source url={event.sourceUrl} source={event.source} /><span className="mono">published {day(event.timestamp)}</span></div>
            <p className="report-title">{PRECISION_META[precision ?? 'exact'].hint}</p>
          </div>
        )}
      </section>

      {incident && (
        <section aria-labelledby="pg-unknown">
          <h2 id="pg-unknown">Unknowns</h2>
          {unknown.length === 0 ? <p className="card-note" style={{ margin: 0 }}>Every question above has at least one supporting report. That does not make each answer certain: see the evidence label on each.</p>
            : unknown.map(f => <FactRow key={f.id} fact={f} />)}
        </section>
      )}

      <section aria-labelledby="pg-where">
        <h2 id="pg-where">Location</h2>
        <p style={{ margin: '0 0 10px' }}>
          {mappable ? <><strong>{PRECISION_META[precision ?? 'exact'].label}.</strong> {PRECISION_META[precision ?? 'exact'].hint}.</> : 'This has no real place, so it is not on the map.'}
        </p>
        {mappable && <button className="pg-btn" onClick={() => onShowOnMap(event)}>Show on the map</button>}
      </section>
    </article>
  );
}
