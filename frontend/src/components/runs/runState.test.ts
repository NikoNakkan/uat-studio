import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../api';
import { RUN_STATE, splitRuns, stateOf, when } from './runState';

describe('when', () => {
  it('falls back to the run id when the time is missing or unreadable', () => {
    expect(when(null, '2026-10-11-0244')).toBe('2026-10-11-0244');
    expect(when('not a date', 'r1')).toBe('r1');
  });
  it('shows a short day and time for a real time', () => {
    expect(when('2026-10-11T02:44:00', 'r1')).toMatch(/11/);
  });
});

describe('RUN_STATE', () => {
  it('has a label for every state the server sends', () => {
    for (const s of ['running', 'waiting', 'signed_off', 'stopped', 'finished', 'not_started'] as const) expect(RUN_STATE[s].label).toBeTruthy();
  });
});

describe('stateOf', () => {
  it('does not break on a state an older server leaves out', () => {
    expect(stateOf(undefined)).toBe(RUN_STATE.not_started);
    expect(stateOf('something new')).toBe(RUN_STATE.not_started);
    expect(stateOf('running')).toBe(RUN_STATE.running);
  });
});

describe('splitRuns', () => {
  const run = (id: string, state: string, running = false, tests = 35) => ({ id, state, running, tests }) as unknown as RunSummary;
  it('puts running and waiting runs first and finds the last run that actually tested', () => {
    const s = splitRuns([run('c', 'running', true, 0), run('b', 'waiting', false, 0), run('a', 'signed_off')]);
    expect(s.active.map(r => r.id)).toEqual(['c', 'b']);
    expect(s.others.map(r => r.id)).toEqual(['a']);
    expect(s.lastTested?.id).toBe('a');
  });
});
