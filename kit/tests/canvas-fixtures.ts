// The fixture for tests of Power Apps canvas apps. It is tests/fixtures.ts (login, console capture, one
// screenshot per step) plus `canvas`: the frame-aware helpers in tests/canvas.ts.
//
// Generated canvas tests import { test, expect } from '../canvas-fixtures' and use:
//   async ({ page, shot, canvas }) => {
//     await page.goto('<start page>');
//     await canvas.waitReady(canvas.control('<a control that shows once the app has loaded>'));
//     await canvas.type(canvas.input('OrderNumberInput'), 'ORD-0412');
//     await canvas.click(canvas.control('SaveButton'));
//     await expect(canvas.control('StatusLabel')).toHaveText('Saved');
import { test as base, expect } from './fixtures';
import { Canvas } from './canvas';

export const test = base.extend<{ canvas: Canvas }>({
  canvas: async ({ page }, use) => {
    await use(new Canvas(page));
  },
});

export { expect };
