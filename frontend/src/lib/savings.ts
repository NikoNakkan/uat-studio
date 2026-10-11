import type { RunSummary, Savings } from '../api';

export type RunSaving = { id: string; created: string | null; ai: number; saved: number | null };

/**
 * What each run that tested the app saved against a person testing it by hand: their rate times the hours,
 * minus what the agents cost. Runs that never reached the tests are left out; nothing is known without a rate.
 */
export function runSavings(runs: RunSummary[], s: Savings) {
  const byHand = s.hourly_rate == null ? null : s.hourly_rate * s.manual_hours;
  const rows: RunSaving[] = runs.filter(r => r.tests > 0)
    .map(r => ({ id: r.id, created: r.created, ai: r.cost ?? 0, saved: byHand == null ? null : byHand - (r.cost ?? 0) }));
  const total = byHand == null ? null : rows.reduce((sum, r) => sum + (r.saved ?? 0), 0);
  return { byHand, rows, total, hours: s.manual_hours * rows.length };
}
