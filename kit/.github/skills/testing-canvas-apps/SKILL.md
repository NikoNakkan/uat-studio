---
name: testing-canvas-apps
description: How to write, check and repair Playwright tests for Power Apps canvas apps - the player frame, data-control-name locators, keyboard typing that fires Power Fx OnChange, galleries, slow first loads and Microsoft Entra ID login. Use for every case whose app type is canvas (start page on apps.powerapps.com).
metadata:
  sources: "microsoft/power-platform-playwright-samples (MIT): CLAUDE.md anti-patterns, src/utils/canvas-helpers.ts; Microsoft Learn: Power Platform Playwright samples. Power Apps Test Engine is deprecated (April 2026) and is not used."
---

# Testing canvas apps

A canvas app is a web page, so the normal flow applies: Excel, clarification, Playwright's planner and
generator, the test check, evidence and sign-off. What is different is **how a test reaches and drives
the controls**. Everything below is enforced by `check_tests.py` (`canvas:` in config/test-check-rules.yaml).

## The five facts

1. **Every control lives inside the player frame** `iframe[name="fullscreen-app-host"]`.
   Tests use the `canvas` fixture, which already points into it. Never `page.locator(...)` for a control.
2. **Every control has `data-control-name`**: the name the maker gave it in Power Apps Studio
   (`SaveButton`, `Gallery1`, `TextInput3`). It is the most stable handle, even when accessibility labels
   are missing. Use `canvas.control('SaveButton')`.
3. **Typing must be real keystrokes.** `fill()` and `pressSequentially()` change the text but do not fire
   Power Fx `OnChange`, so the app never sees the value. Use `canvas.type(locator, 'value')`.
4. **Galleries are virtualised and covered by overlays.** Only rows in view exist in the page; invisible
   overlays can intercept clicks. Use `canvas.galleryItems('Gallery1')`, `canvas.scrollTo(...)` and
   `canvas.click(...)`.
   Pick a row by its text, `canvas.galleryItems('Gallery1').filter({ hasText: 'ORD-0412' })`, never by
   position (`nth(3)`): when the gallery scrolls it renders other rows, and position 3 is then another row.
   `first()` is fine only where the Excel says "at the top of the list".
5. **The first screen can take 10 to 60 seconds** (Dataverse). Right after `goto`, wait for a control that
   only shows once the app has loaded: `canvas.waitReady(canvas.control('Gallery1'))`. Never fixed waits.

## A generated canvas test

```ts
// spec: specs/orders.plan.md
import { test, expect } from '../canvas-fixtures';
test.use({ loginAs: 'EMPLOYEE_TEST_ACCOUNT' });

test.describe('Orders', () => {
  test('TC-01 Create an order', async ({ page, shot, canvas }) => {
    await page.goto('https://apps.powerapps.com/play/e/<env>/a/<app>?tenantId=<tenant>');
    await canvas.waitReady(canvas.galleryItems('Gallery1'));
    // 1. Click "New order"
    await canvas.click(canvas.control('NewOrderButton'));
    await shot(1);
    // 2. Type "ORD-0412" in Order number
    await canvas.type(canvas.input('OrderNumberInput'), 'ORD-0412');
    await shot(2);
    // 3. Click "Save"
    await canvas.click(canvas.control('SaveButton'));
    // Expected 3: The order "ORD-0412" appears at the top of the list
    await expect(canvas.galleryItems('Gallery1').first()).toContainText('ORD-0412');
    await shot(3);
  });
});
```

Checks (`expect`) go on the control named in the app map, by its `data-control-name`, with the exact
quoted value from the Excel (`toHaveText`, `toContainText`, `toHaveValue`). A check that a gallery or
container merely exists proves nothing and is rejected.

## Helpers (tests/canvas.ts)

| Helper | Use for |
| --- | --- |
| `canvas.control(name)` | Any control by its data-control-name |
| `canvas.input(name)` | The editable field inside a text input control |
| `canvas.galleryItems(name)` | The rows a gallery renders now |
| `canvas.waitReady(locator, timeout?)` | After goto: wait until the app shows its first real control |
| `canvas.type(locator, value)` | Typing that fires OnChange (click, select all, type) |
| `canvas.click(locator)` | A click that goes through a gallery overlay only when one intercepts |
| `canvas.scrollTo(gallery, item)` | Scroll a virtualised gallery until a row is rendered |

## Never in a canvas test

`.nth(` on gallery rows, `fill(`, `pressSequentially(`, `frameLocator(`, `force: true`, `page.locator('[data-control-name...`,
`waitForTimeout`, `if`, `try`, `evaluate(`. Model-driven tricks from Microsoft's guide that need
`evaluate()` (Xrm `setValue`, `el.select()`) are not allowed in UAT tests: a person must see the same
thing the test does.

## Login

Microsoft Entra ID. Two ways, both in the setting-up-login skill (`references/login-patterns.md`,
pattern "Microsoft Entra ID"):
- **Form login** written once in `tests/login.ts` (email, Next, password, Sign in, "Stay signed in?" No).
- **Accounts with MFA or certificate sign-in**: sign in with Microsoft's tool (`npm run auth:headful` in
  `power-platform-playwright-samples/packages/e2e-tests`), then set `<ACCOUNT>_STORAGE_STATE` in `.env` to
  the saved `state-<email>.json`. The fixture uses that session as it is. Sessions last about 24 hours.

## Sites

Add `https://apps.powerapps.com` and `https://login.microsoftonline.com` to allowed_origins
(config/power-platform.yaml lists the others). The guard accepts `https://*.crm.dynamics.com` style entries.

## Repairs (healer)

Common canvas breakages and the right repair: a control renamed in Studio (new `data-control-name`:
update the locator, never the check), a slower first load (raise `waitReady` timeout), a row out of view
(add `canvas.scrollTo`). The assertion lock still applies.
