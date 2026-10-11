import type { RunState, RunSummary } from '../../api';

/** How each run state reads and looks, everywhere a run is listed. */
export const RUN_STATE: Record<RunState, { label: string; badge: string; bar: string }> = {
  waiting: { label: 'Waiting for you', badge: 'bg-warn/15 text-warn', bar: 'bg-warn' },
  running: { label: 'Running', badge: 'bg-accent/20 text-ink', bar: 'bg-accent' },
  signed_off: { label: 'Signed off', badge: 'bg-good/15 text-good', bar: 'bg-good' },
  finished: { label: 'Ready to sign off', badge: 'bg-good/10 text-good', bar: 'bg-good' },
  stopped: { label: 'Stopped', badge: 'bg-bad/10 text-bad', bar: 'bg-bad' },
  not_started: { label: 'Not started', badge: 'bg-surface-2 text-muted', bar: 'bg-line' },
};

/** A run's look; an unknown or missing state (an older server) reads as "Not started" instead of breaking the page. */
export function stateOf(state: string | undefined) {
  return RUN_STATE[state as RunState] ?? RUN_STATE.not_started;
}

/** "11 Oct, 02:44" from the run's ISO time; the run id when the time is unknown. */
export function when(created: string | null, fallback: string): string {
  if (!created) return fallback;
  const d = new Date(created);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** The home page's view of the runs: what is going on now, the rest newest first, and the last run that tested. */
export function splitRuns(runs: RunSummary[]) {
  const isActive = (r: RunSummary) => r.running || r.state === 'waiting';
  return {
    active: runs.filter(isActive),
    others: runs.filter(r => !isActive(r)),
    lastTested: runs.find(r => !isActive(r) && r.tests > 0),
  };
}
