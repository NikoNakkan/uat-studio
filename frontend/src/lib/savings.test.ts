import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../api';
import { usd } from './money';
import { runSavings } from './savings';

const run = (id: string, tests: number, cost: number) => ({ id, created: null, tests, cost }) as RunSummary;

describe('runSavings', () => {
  it('counts only runs that tested the app: rate times hours, minus the AI cost', () => {
    const s = runSavings([run('a', 35, 14), run('b', 0, 2), run('c', 35, 10)], { hourly_rate: 40, manual_hours: 4 });
    expect(s.byHand).toBe(160);
    expect(s.rows.map(r => [r.id, r.saved])).toEqual([['a', 146], ['c', 150]]);
    expect(s.total).toBe(296);
    expect(s.hours).toBe(8);
  });
  it('knows nothing until a rate is entered', () => {
    const s = runSavings([run('a', 35, 14)], { hourly_rate: null, manual_hours: 4 });
    expect(s.total).toBeNull();
    expect(s.rows[0].saved).toBeNull();
  });
});

describe('usd for savings', () => {
  it('shows a loss as a negative estimate', () => {
    expect(usd(-12.4)).toBe('≈ −$12');
  });
});
