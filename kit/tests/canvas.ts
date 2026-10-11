// Power Apps canvas apps: how a generated test reaches and drives the controls. No AI at run time.
//
// Adapted from microsoft/power-platform-playwright-samples (MIT, Copyright (c) Microsoft Corporation),
// src/utils/canvas-helpers.ts and components/canvas/canvas-app-runtime.page.ts, with one change: every
// helper here works INSIDE the canvas player frame. Several of the toolkit's helpers look up elements on
// the outer page, which finds nothing for a canvas app in play mode.
//
// Facts these helpers are built on (Microsoft's guide, CLAUDE.md in that repository):
//  - In play mode every control lives in the frame iframe[name="fullscreen-app-host"].
//  - Every control carries data-control-name="<the name the maker gave it in Power Apps Studio>".
//  - fill() and pressSequentially() change the input's text but do NOT fire Power Fx OnChange;
//    keyboard typing does. So text is always typed with type() below.
//  - Galleries render invisible overlays that can intercept clicks, and only render the rows in view.
//  - Apps backed by Dataverse can take 10 to 60 seconds to show their first data.
import type { FrameLocator, Locator, Page } from '@playwright/test';

export const CANVAS_FRAME = 'iframe[name="fullscreen-app-host"]';
export const READY_TIMEOUT = 60_000;

export class Canvas {
  readonly frame: FrameLocator;

  constructor(readonly page: Page, frameSelector: string = CANVAS_FRAME) {
    this.frame = page.frameLocator(frameSelector);
  }

  /** A control by the name the maker gave it in Power Apps Studio (data-control-name). */
  control(name: string): Locator {
    return this.frame.locator(`[data-control-name="${name}"]`);
  }

  /** The rows a gallery currently renders (galleries only render the rows in view). */
  galleryItems(galleryName: string): Locator {
    return this.control(galleryName).locator('[data-control-part="gallery-item"]');
  }

  /** The editable input inside a text input control. */
  input(name: string): Locator {
    return this.control(name).locator('input, textarea').first();
  }

  /** Waits until a control that only exists once the app has loaded is visible. Use after goto(). */
  async waitReady(locator: Locator, timeout = READY_TIMEOUT): Promise<void> {
    await locator.first().waitFor({ state: 'visible', timeout });
  }

  /** Types text the way a person does, so Power Fx OnChange fires (fill() would not). */
  async type(locator: Locator, value: string): Promise<void> {
    await locator.click();
    await this.page.waitForTimeout(200);            // let the canvas engine focus the control
    await this.page.keyboard.press('Control+a');
    await this.page.waitForTimeout(150);            // let the selection settle before typing replaces it
    await this.page.keyboard.type(value);
  }

  /**
   * Clicks a control; when an invisible gallery overlay intercepts the pointer, clicks through it.
   * The plain click gets only a few seconds: while it retries, Playwright scrolls the gallery to other
   * positions, and a virtualised gallery then renders other rows (so pick rows by text, never by position).
   */
  async click(locator: Locator, timeout = 10_000): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout });
    try {
      await locator.click({ timeout: Math.min(timeout, 3_000) });
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (/intercepts pointer events|outside of the viewport/.test(message)) {
        await locator.click({ force: true, timeout });
      } else {
        await locator.click({ timeout });               // slow to enable, not covered: keep waiting normally
      }
    }
  }

  /** Scrolls a gallery until the wanted row is rendered (rows out of view are not in the page). */
  async scrollTo(galleryName: string, item: Locator, maxScrolls = 30): Promise<void> {
    const anchor = this.galleryItems(galleryName).first();
    await anchor.waitFor({ state: 'visible', timeout: 30_000 });
    const box = await anchor.boundingBox();
    if (box) await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let up = 0; up < 15; up++) await this.page.mouse.wheel(0, -250);   // new rows sort to the top
    for (let step = 0; step < maxScrolls; step++) {
      if (await item.isVisible()) return;
      await this.page.mouse.wheel(0, 250);
      await this.page.waitForTimeout(300);
    }
    if (!(await item.isVisible())) throw new Error(`scrollTo: no matching row in gallery ${galleryName} after ${maxScrolls} scrolls`);
  }
}
