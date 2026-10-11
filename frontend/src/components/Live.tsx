import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Event } from '../api';
import { useEvents, type LiveStatus } from '../lib/useEvents';
import { Activity } from './Activity';

const Ctx = createContext<{ events: Event[]; live: LiveStatus; scope: 'app' | 'run' }>({ events: [], live: 'connecting', scope: 'app' });

/** One live feed for the whole window: setup commands on most pages, the open run on a run page. */
export function LiveProvider({ channel, refresh, scope, children }: { channel: string; refresh: unknown[][]; scope: 'app' | 'run'; children: ReactNode }) {
  const { events, live } = useEvents(channel, refresh);
  return <Ctx.Provider value={{ events, live, scope }}>{children}</Ctx.Provider>;
}

export function useLive() {
  return useContext(Ctx);
}

const COLLAPSED_KEY = 'uat-live-collapsed';

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

function writeCollapsed(v: boolean) {
  try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); } catch { /* private window: just not remembered */ }
}

export function LiveRail() {
  const { events, live, scope } = useLive();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [seen, setSeen] = useState(events.length);          // events shown before collapsing: the rest are new
  const toggle = (v: boolean) => { setCollapsed(v); writeCollapsed(v); setSeen(events.length); };
  const fresh = Math.max(0, events.length - seen);
  const dot = live === 'live' ? 'bg-good' : 'animate-pulse bg-warn';

  if (collapsed) {
    return (
      <aside aria-label="Live (collapsed)" className="flex shrink-0 items-center border-t border-line bg-surface lg:h-full lg:w-11 lg:flex-col lg:border-l lg:border-t-0">
        <button type="button" onClick={() => toggle(false)} aria-expanded={false} title="Show the live activity"
          className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2 lg:h-full lg:flex-col lg:px-0 lg:py-3">
          <span aria-hidden className="text-muted lg:rotate-0">‹</span>
          <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
          <span className="font-semibold lg:[writing-mode:vertical-rl] lg:rotate-180">Live</span>
          {fresh > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-medium text-accent-ink tnum" title={`${fresh} new since you hid it`}>{fresh > 99 ? '99+' : fresh}</span>}
        </button>
      </aside>
    );
  }

  return (
    <aside aria-label="Live" className="flex h-[46vh] shrink-0 flex-col border-t border-line bg-surface lg:h-full lg:w-[min(50%,52rem)] lg:min-w-[36rem] lg:border-l lg:border-t-0">
      <header className="flex shrink-0 items-start gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Live</div>
          <div className="text-xs text-muted">{scope === 'run' ? 'This run. The agent, and every command it runs.' : 'Setup. The agent, and every command it runs.'}</div>
        </div>
        <button type="button" onClick={() => toggle(true)} aria-expanded title="Hide the live activity"
          className="rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-ink">Hide ›</button>
      </header>
      <div className="min-h-0 flex-1 p-2">
        <Activity docked events={events} live={live}
          empty={scope === 'run'
            ? 'Nothing yet. Start the run and the agent shows up here.'
            : 'Nothing yet. Set up login, or fix this machine, and the agent and commands show up here.'} />
      </div>
    </aside>
  );
}
