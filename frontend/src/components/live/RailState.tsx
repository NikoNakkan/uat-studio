import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { readStored, writeStored } from '../../lib/storage';

const COLLAPSED_KEY = 'uat-live-collapsed';
const SEEN_KEY = 'uat-live-seen-at';

type Rail = {
  collapsed: boolean;
  /** When the person last had the panel open (ms), for what counts as new. */
  seenAt: number;
  setCollapsed: (hide: boolean) => void;
  /** Bumped when someone asks to see the open question; the feed scrolls to it. */
  focusTick: number;
  revealQuestion: () => void;
};

const Ctx = createContext<Rail | null>(null);

/** The live panel's state, shared so a link elsewhere ("1 waiting for you") can open it at the question. */
export function RailProvider({ children }: { children: ReactNode }) {
  const [collapsed, setHidden] = useState(() => readStored(COLLAPSED_KEY) === '1');
  const [seenAt, setSeenAt] = useState(() => Number(readStored(SEEN_KEY)) || Date.now());
  const [focusTick, setFocusTick] = useState(0);
  const setCollapsed = useCallback((hide: boolean) => {
    const now = Date.now();
    setHidden(hide); setSeenAt(now);
    writeStored(COLLAPSED_KEY, hide ? '1' : '0'); writeStored(SEEN_KEY, String(now));
  }, []);
  const revealQuestion = useCallback(() => { setCollapsed(false); setFocusTick(t => t + 1); }, [setCollapsed]);
  const value = useMemo(() => ({ collapsed, seenAt, setCollapsed, focusTick, revealQuestion }),
    [collapsed, seenAt, setCollapsed, focusTick, revealQuestion]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRail(): Rail {
  const rail = useContext(Ctx);
  if (!rail) throw new Error('RailProvider is missing');
  return rail;
}
