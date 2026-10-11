import { describe, expect, it } from 'vitest';
import { usd } from './money';

describe('usd', () => {
  it('reads as an estimate: whole dollars from $1 up', () => {
    expect(usd(14.4578)).toBe('≈ $14');
    expect(usd(9.5)).toBe('≈ $10');
  });
  it('keeps cents below a dollar, and nothing as $0', () => {
    expect(usd(0.25)).toBe('≈ $0.25');
    expect(usd(0)).toBe('$0');
    expect(usd(undefined)).toBe('$0');
  });
  it('does not round a real cost down to nothing', () => {
    expect(usd(0.004)).toBe('under $0.01');
  });
});
