// Shared fixture for every generated test. No AI involved.
//  - loginAs (option): the account key of the case's "Login as" column, e.g. EMPLOYEE_TEST_ACCOUNT.
//    The fixture logs in once per account and run (tests/login.ts), keeps the browser session in
//    runs/<run-id>/auth/<account>.json, and every test of that account starts from it. Passwords never
//    leave process.env.
//  - errorLog (automatic): records every console error, failed request and 4xx/5xx response (decision 31)
//  - shot(N): saves the screenshot for Excel step N, named <TestID>-step<N>.png (decision 19)
// Generated tests import { test, expect } from '../fixtures' and, when the case names an account,
// add test.use({ loginAs: '<ACCOUNT_KEY>' }) after the import (check_tests.py verifies it).
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { expectLoggedIn, login } from './login';

const runDir = path.resolve(process.env.UAT_RUN_DIR ?? 'runs/current');
const evidenceDir = path.resolve(process.env.UAT_EVIDENCE_DIR ?? path.join(runDir, 'evidence'));
const masks: string[] = JSON.parse(process.env.UAT_SCREEN_MASKS ?? '[]');
// Switched off in config/profile.yaml -> scripts/run_tests.py sets these to 0
const shotsOn = process.env.UAT_SHOTS !== '0';
const consoleOn = process.env.UAT_CONSOLE !== '0';
// A saved session older than this is logged in again (minutes). Set UAT_SESSION_MAX_AGE_MIN in the environment.
const sessionMaxAgeMs = Number(process.env.UAT_SESSION_MAX_AGE_MIN ?? 30) * 60_000;

type Options = {
  loginAs: string;
};

type Fixtures = {
  uatStep: { current: number };
  errorLog: void;
  shot: (step: number) => Promise<void>;
};

// "TC-01 Add an expense" -> "TC-01"
const testIdOf = (title: string) => title.split(' ')[0];
// --repeat-each runs the same test several times: keep each run's files apart
const suffix = (repeat: number) => (repeat ? `-r${repeat}` : '');

export const test = base.extend<Options & Fixtures>({
  // Set per test file with test.use({ loginAs: 'EMPLOYEE_TEST_ACCOUNT' }). Seeds and the login check
  // take it from UAT_LOGIN_AS instead, because Playwright's agents run them without our scripts.
  loginAs: ['', { option: true }],

  // Playwright's own storageState option, decided per account: log in once, reuse the session.
  storageState: async ({ loginAs, browser }, use) => {
    const account = loginAs || process.env.UAT_LOGIN_AS || '';
    if (!account) return use(undefined);
    if (!/^[A-Z0-9_]+$/.test(account)) throw new Error(`loginAs must be an account key like EMPLOYEE_TEST_ACCOUNT, not "${account}"`);
    // An account that cannot log in by form (MFA, certificate sign-in to Microsoft Entra ID) can point
    // <ACCOUNT>_STORAGE_STATE in the environment at a session file saved by its own sign-in tool, for example
    // `npm run auth:headful` in microsoft/power-platform-playwright-samples. That session is used as it is.
    const external = process.env[`${account}_STORAGE_STATE`];
    if (external) {
      if (!fs.existsSync(external)) throw new Error(`${account}_STORAGE_STATE points at a missing file; sign in again with your sign-in tool`);
      return use(external);
    }
    const file = path.join(runDir, 'auth', `${account}.json`);
    const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < sessionMaxAgeMs;
    if (!fresh) {
      const user = process.env[`${account}_USER`];
      const password = process.env[`${account}_PASSWORD`];
      if (!user || !password) throw new Error(`No ${account}_USER / ${account}_PASSWORD in the environment (UAT Studio: Set up, Test accounts)`);
      const page = await browser.newPage({ storageState: undefined });
      try {
        await page.goto(process.env.START_PAGE ?? '/');
        await login(page, user, password);
        await expectLoggedIn(page);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await page.context().storageState({ path: file });
      } finally {
        await page.close();
      }
    }
    await use(file);
  },

  uatStep: async ({}, use) => {
    await use({ current: 0 });
  },

  errorLog: [async ({ page, uatStep }, use, testInfo) => {
    if (!consoleOn) return use();
    const errors: object[] = [];
    const step = () => uatStep.current + 1;   // the step in progress
    page.on('console', m => {
      if (m.type() === 'error') errors.push({ kind: 'console', step: step(), text: m.text() });
    });
    page.on('pageerror', e => errors.push({ kind: 'page error', step: step(), text: e.message }));
    page.on('requestfailed', r => errors.push({ kind: 'request failed', step: step(), url: r.url(), text: r.failure()?.errorText ?? '' }));
    page.on('response', r => {
      if (r.status() >= 400) errors.push({ kind: 'response', step: step(), url: r.url(), status: r.status() });
    });
    await use();
    const id = testIdOf(testInfo.title);
    const file = path.join(evidenceDir, 'console', `${id}${suffix(testInfo.repeatEachIndex)}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ test_id: id, title: testInfo.title, status: testInfo.status, errors }, null, 2));
  }, { auto: true }],

  shot: async ({ page, uatStep }, use, testInfo) => {
    await use(async (step: number) => {
      uatStep.current = step;
      if (!shotsOn) return;
      const id = testIdOf(testInfo.title);
      const file = path.join(evidenceDir, 'screenshots', `${id}-step${step}${suffix(testInfo.repeatEachIndex)}.png`);
      await page.screenshot({ path: file, animations: 'disabled', mask: masks.map(s => page.locator(s)) });
      await testInfo.attach(`step ${step}`, { path: file, contentType: 'image/png' });
    });
  },
});

export { expect };
