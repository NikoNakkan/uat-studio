import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Event } from '../api';
import { readStored, writeStored } from '../lib/storage';
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
const SEEN_KEY = 'uat-live-seen-at';
/** What is worth a badge: what the agents say and ask, stage changes, errors. Not every tool step. */
const NOTEWORTHY = new Set(['agent_text', 'waiting', 'stage', 'run', 'agent_error', 'finding']);

/**
 * New is what arrived after the person last had the panel open, by time, remembered across reloads. Counting
 * events instead made the whole history look new whenever it was replayed (page change, reload, new channel).
 */
export function unread(events: Event[], seenAt: number) {
  const fresh = events.filter(e => e.ts * 1000 > seenAt && NOTEWORTHY.has(e.type));
  return { count: fresh.length, question: fresh.some(e => e.type === 'waiting') };
}

export function LiveRail() {
  const { events, live, scope } = useLive();
  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSED_KEY) === '1');
  const [seenAt, setSeenAt] = useState(() => Number(readStored(SEEN_KEY)) || Date.now());
  const toggle = (hide: boolean) => {
    const now = Date.now();
    setCollapsed(hide); setSeenAt(now);
    writeStored(COLLAPSED_KEY, hide ? '1' : '0'); writeStored(SEEN_KEY, String(now));
  };
  const fresh = unread(events, seenAt);
  const dot = live === 'live' ? 'bg-good' : 'animate-pulse bg-warn';

  if (collapsed) {
    return (
      <aside aria-label="Live (collapsed)" className="flex shrink-0 items-center border-t border-line bg-surface lg:h-full lg:w-11 lg:flex-col lg:border-l lg:border-t-0">
        <button type="button" onClick={() => toggle(false)} aria-expanded={false} title="Show the live activity"
          className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2 lg:h-full lg:flex-col lg:px-0 lg:py-3">
          <span aria-hidden className="text-muted lg:rotate-0">‹</span>
          <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
          <span className="font-semibold lg:[writing-mode:vertical-rl] lg:rotate-180">Live</span>
          {fresh.count > 0 && <span className={`rounded-full px-1.5 text-[11px] font-medium tnum ${fresh.question ? 'bg-warn text-white' : 'bg-accent text-accent-ink'}`}
            title={fresh.question ? 'A question is waiting for you' : `${fresh.count} new since you last looked`}>{fresh.count > 99 ? '99+' : fresh.count}</span>}
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
