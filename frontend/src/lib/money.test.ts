import { describe, expect, it } from 'vitest';
import { usd } from './money';

describe('usd', () => {
  it('shows cents, and nothing as $0.00', () => {
    expect(usd(14.4578)).toBe('$14.46');
    expect(usd(0)).toBe('$0.00');
    expect(usd(undefined)).toBe('$0.00');
  });
  it('does not round a real cost down to nothing', () => {
    expect(usd(0.004)).toBe('under $0.01');
  });
});
