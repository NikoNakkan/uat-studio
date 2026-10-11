// Checks tests/canvas.ts and tests/canvas-fixtures.ts against a fake canvas player that behaves like the real
// one: controls in iframe[name="fullscreen-app-host"], OnChange only on keystrokes, virtualised gallery rows
// covered by a click layer, and a slow first load.
import { test, expect } from '../../tests/canvas-fixtures';

test.beforeEach(async ({ page }) => { await page.goto('/index.html'); });

test('controls are reached inside the frame, not on the outer page', async ({ page, canvas }) => {
  await canvas.waitReady(canvas.control('Gallery1'));
  await expect(page.locator('[data-control-name="SaveButton"]')).toHaveCount(0);
  await expect(canvas.control('SaveButton')).toHaveText('Save');
});

test('type() fires OnChange, so the app sees the value', async ({ canvas, shot }) => {
  await canvas.waitReady(canvas.galleryItems('Gallery1'));
  await canvas.type(canvas.input('OrderNumberInput'), 'ORD-0412');
  await canvas.click(canvas.control('SaveButton'));
  await expect(canvas.control('StatusLabel')).toHaveText('Saved ORD-0412');
  await expect(canvas.galleryItems('Gallery1').first()).toContainText('ORD-0412');
  await shot(1);
});

test('type() replaces what was there before', async ({ canvas }) => {
  await canvas.waitReady(canvas.control('Gallery1'));
  await canvas.type(canvas.input('OrderNumberInput'), 'WRONG');
  await canvas.type(canvas.input('OrderNumberInput'), 'ORD-0500');
  await canvas.click(canvas.control('SaveButton'));
  await expect(canvas.control('StatusLabel')).toHaveText('Saved ORD-0500');
});

test('premise: fill() changes the text but the app never sees it', async ({ canvas }) => {
  await canvas.waitReady(canvas.control('Gallery1'));
  await canvas.input('OrderNumberInput').fill('ORD-0412');
  await expect(canvas.input('OrderNumberInput')).toHaveValue('ORD-0412');
  await canvas.click(canvas.control('SaveButton'));
  await expect(canvas.control('StatusLabel')).toHaveText('Order number is required');
});

test('premise: a plain click on a gallery row is intercepted; canvas.click goes through', async ({ canvas }) => {
  await canvas.waitReady(canvas.galleryItems('Gallery1'));
  const title = canvas.galleryItems('Gallery1').filter({ hasText: 'ORD-0002' }).locator('[data-control-name="Title1"]');
  await expect(title.click({ timeout: 2000 })).rejects.toThrow(/intercepts pointer events/);
  await canvas.click(title);
  await expect(canvas.control('SelectedLabel')).toHaveText('Selected ORD-0002');
});

test('scrollTo() brings a row that is not rendered yet into view', async ({ canvas }) => {
  await canvas.waitReady(canvas.galleryItems('Gallery1'));
  const row40 = canvas.galleryItems('Gallery1').filter({ hasText: 'ORD-0040' });
  await expect(row40).toHaveCount(0);                    // virtualised: not in the page yet
  await canvas.scrollTo('Gallery1', row40);
  await canvas.click(row40.locator('[data-control-name="Title1"]'));
  await expect(canvas.control('SelectedLabel')).toHaveText('Selected ORD-0040');
});

test('waitReady() fails with a clear timeout when the app never loads', async ({ canvas }) => {
  await expect(canvas.waitReady(canvas.control('NoSuchControl'), 4000)).rejects.toThrow(/Timeout 4000ms/);
});
