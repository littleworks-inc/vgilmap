import { useEffect, useMemo, useRef, useState } from 'react';
import type { Domain, VigilEvent } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';
import { ago } from '../../shared/pipeline/health';
import { buildBriefing } from './briefing';
import type { BriefCard } from './briefing';
import { loadSeen, saveSeen } from './seen';
import { IncidentPage } from './IncidentPage';
import './today.css';

const DOMAIN_LABEL: Record<Domain, string> = {
  disaster: 'Disaster', climate: 'Weather & climate', health: 'Health', conflict: 'Conflict',
  economic: 'Economy', labor: 'Labor', science: 'Space & science', cyber: 'Cyber',
};
const THEME_KEY = 'vigil.today.theme';

function readTheme(): 'light' | 'dark' {
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

function Card({ card, now, selected, onOpen }: { card: BriefCard; now: number; selected: boolean; onOpen: () => void }) {
  const age = ago(now - Date.parse(card.published));
  const strongest = card.incident ? card.incident.evidence[0] : card.event.evidence;
  return (
    <article className="card" data-sev={card.severity} data-card-id={card.id} aria-current={selected || undefined}>
      <div className="card-meta">
        <span>{DOMAIN_LABEL[card.domain]}</span>
        <span className={`sev sev-${card.severity}`}>{card.severity}</span>
      </div>
      <h3><button onClick={onOpen} title={card.headline}>{card.headline}</button></h3>
      <div className="card-where">
        {card.place} · <time className="mono" dateTime={card.published} title={new Date(card.published).toLocaleString()}>{age}</time>
        {card.occurred && <> · happened <span className="mono">{new Date(card.occurred).toLocaleDateString()}</span></>}
      </div>
      <p className={`card-change ${card.change.kind}`}>{card.change.text}</p>
      <p className="card-evidence">
        {/* A dot in the colour of the strongest evidence, then the plain-language summary (no duplicate badge). */}
        {strongest && <span className={`ev-dot ev-${strongest}`} aria-hidden="true" />}
        <span>{card.evidenceSummary}</span>
      </p>
      {card.note && <p className="card-note">{card.note}</p>}
      <button className="card-open" onClick={onOpen}>Open</button>
    </article>
  );
}

interface TodayViewProps {
  /** Live events in the current window (not collapsed: the briefing groups incidents itself). */
  events: VigilEvent[];
  lastUpdated: Date | null;
  loading: boolean;
  onExplore: () => void;
  onShowOnMap: (ev: VigilEvent) => void;
}

/**
 * Today: a short briefing rather than a control room. What is new for you, then the most significant
 * developments elsewhere, each card saying what it rests on. The globe stays one tap away as Explore.
 */
export function TodayView({ events, lastUpdated, loading, onExplore, onShowOnMap }: TodayViewProps) {
  const isMobile = useIsMobile();
  const [theme, setTheme] = useState(readTheme);
  const [now, setNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prev] = useState(() => loadSeen()); // the snapshot from the LAST visit, fixed for this one

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const briefing = useMemo(() => buildBriefing({ events, seen: prev, now }), [events, prev, now]);
  const eventsById = useMemo(() => new Map(events.map(e => [e.id, e])), [events]);

  // Remember what was on screen when the tab is hidden or closed, so the next visit can say what is new.
  const snapshotRef = useRef(briefing.snapshot);
  useEffect(() => { snapshotRef.current = briefing.snapshot; }, [briefing.snapshot]);
  useEffect(() => {
    const save = () => { if (Object.keys(snapshotRef.current).length > 0) saveSeen(snapshotRef.current, Date.now()); };
    const onHide = () => { if (document.visibilityState === 'hidden') save(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', save);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', save); save(); };
  }, []);

  const chooseTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* preference only */ }
  };

  const all = [...briefing.sinceLast, ...briefing.major];
  const selected = all.find(c => c.id === selectedId) ?? null;
  const showFeed = !(isMobile && selected); // on a phone an open incident is a full page, not a side panel
  const visitDate = briefing.lastVisitAt ? new Date(briefing.lastVisitAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null;

  return (
    <div className="today" data-theme={theme}>
      <header className="t-top">
        <span className="t-brand">🌍 VigilMap</span>
        <nav className="t-nav" aria-label="Primary">
          <button aria-current="page">Today</button>
          <button onClick={onExplore}>Explore</button>
        </nav>
        <span className="t-spacer" />
        <span className="t-status" role="status">{loading ? 'Loading sources…' : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { timeStyle: 'short' })}` : ''}</span>
        <button className="t-theme" onClick={chooseTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? 'Dark' : 'Light'}</button>
      </header>

      <div className="t-body">
        {showFeed && (
          <main className="t-feed">
            <div className="t-feed-inner">
              <h1 className="t-h1">{visitDate ? 'Since you last visited' : "Today's briefing"}</h1>
              <p className="t-sub">{visitDate ? `Your last visit: ${visitDate}.` : 'A global briefing. Open an item to see what it rests on.'}</p>

              {visitDate && (
                <section className="t-section" aria-labelledby="t-new">
                  <h2 id="t-new">New or updated</h2>
                  {loading && events.length === 0 ? <div className="t-empty">Loading…</div>
                    : briefing.sinceLast.length === 0 ? <div className="t-empty">Nothing new since your last visit.</div>
                    : briefing.sinceLast.map(c => <Card key={c.id} card={c} now={now} selected={c.id === selectedId} onOpen={() => setSelectedId(c.id)} />)}
                </section>
              )}

              <section className="t-section" aria-labelledby="t-major">
                <h2 id="t-major">{visitDate ? 'Other major developments' : 'Major developments'}</h2>
                {loading && events.length === 0 ? <div className="t-empty">Loading…</div>
                  : briefing.major.length === 0 ? <div className="t-empty">No major developments in this window.</div>
                  : briefing.major.map(c => <Card key={c.id} card={c} now={now} selected={c.id === selectedId} onOpen={() => setSelectedId(c.id)} />)}
              </section>

              <p className="t-note">
                “Since you last visited” compares with what this browser showed last time (stored only on this device). It reports new items and added reports; it cannot yet show edits or corrections, which need stored incident history.
              </p>
            </div>
          </main>
        )}
        {selected && (
          <aside className="t-panel" aria-label="Incident details">
            <IncidentPage card={selected} eventsById={eventsById} lastVisitAt={briefing.lastVisitAt} onBack={() => setSelectedId(null)} onShowOnMap={onShowOnMap} />
          </aside>
        )}
      </div>
    </div>
  );
}
