/**
 * Persisting the user's VIEW across page refreshes: the time window and which domains are hidden.
 *
 * Precedence: URL  >  last saved view (localStorage)  >  defaults.
 *   - If the URL carries any view parameter it fully defines the view. A shared link must look the
 *     same for everyone, so the recipient's own saved filters must not leak into it.
 *   - Otherwise the last-used view is restored, then the defaults.
 * The URL is kept in sync (defaults are omitted so the plain URL stays clean), so any view can be
 * bookmarked or shared. Everything transient (search text, "show all", the cyber drill-down, the
 * globe position) is deliberately NOT persisted and starts fresh.
 *
 *   ?window=24h&hide=cyber,labor      (hidden domains rather than visible ones, so a domain added
 *                                       in a later version shows up by default)
 */
import { DEFAULT_TIME_WINDOW, TIME_WINDOWS } from '../types';
import type { Domain, TimeWindowId } from '../types';

const STORAGE_KEY = 'vigil.view.v1';

export interface ViewState {
  timeWindow: TimeWindowId;
  hidden: Domain[];
}

const isWindow = (v: unknown): v is TimeWindowId => TIME_WINDOWS.some(w => w.id === v);

function cleanHidden(value: unknown, all: readonly Domain[]): Domain[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return all.filter(d => list.includes(d)); // drops unknown names, keeps registry order
}

export function defaultView(): ViewState {
  return { timeWindow: DEFAULT_TIME_WINDOW, hidden: [] };
}

export function readViewState(all: readonly Domain[]): ViewState {
  // 1) URL
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has('window') || q.has('hide')) {
      const w = q.get('window');
      return { timeWindow: isWindow(w) ? w : DEFAULT_TIME_WINDOW, hidden: cleanHidden(q.get('hide'), all) };
    }
  } catch { /* fall through */ }

  // 2) last saved view
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ViewState> | null;
    if (saved) {
      return { timeWindow: isWindow(saved.timeWindow) ? saved.timeWindow : DEFAULT_TIME_WINDOW, hidden: cleanHidden(saved.hidden, all) };
    }
  } catch { /* storage unavailable or corrupt */ }

  // 3) defaults
  return defaultView();
}

export function isDefaultView(v: ViewState): boolean {
  return v.timeWindow === DEFAULT_TIME_WINDOW && v.hidden.length === 0;
}

export function writeViewState(v: ViewState): void {
  try {
    const url = new URL(window.location.href);
    if (v.timeWindow === DEFAULT_TIME_WINDOW) url.searchParams.delete('window'); else url.searchParams.set('window', v.timeWindow);
    if (v.hidden.length === 0) url.searchParams.delete('hide'); else url.searchParams.set('hide', v.hidden.join(','));
    history.replaceState(null, '', url.toString()); // keeps other params (e.g. ?event=) intact
  } catch { /* ignore */ }
  try {
    if (isDefaultView(v)) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch { /* ignore */ }
}
