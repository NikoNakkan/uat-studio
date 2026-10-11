import { describe, expect, it } from 'vitest';
import { clampWidth } from './useResizableWidth';

describe('clampWidth', () => {
  it('keeps the panel between 320px and the window minus room for the page', () => {
    expect(clampWidth(100, 1600)).toBe(320);
    expect(clampWidth(700, 1600)).toBe(700);
    expect(clampWidth(1500, 1600)).toBe(1120);
  });
  it('never goes under the minimum, even in a narrow window', () => {
    expect(clampWidth(600, 700)).toBe(320);
  });
});
