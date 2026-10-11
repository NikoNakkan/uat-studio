// The one place that knows how to log in to the app under test. No AI at run time.
//
// Written once per app, by the uat-login-setup agent (/setup-login) or by hand, from the login
// page recorded in app-map/app-map.yaml. tests/fixtures.ts calls it when a test says
// test.use({ loginAs: 'EMPLOYEE_TEST_ACCOUNT' }) and no fresh session is cached for that account.
//
// Rules:
//  - `user` and `password` come from .env through the fixture. Never log, print or attach them.
//  - Element names come from the app map (role + visible name), exactly as the planner saw them.
//  - expectLoggedIn() must check something that is only on screen after a successful login.
//  - Supported login shapes and what to do with the others: .github/skills/setting-up-login/references/login-patterns.md
//
// This is the blank template (templates/login.ts). tests/login.ts starts as a copy of it.
import { expect, type Page } from '@playwright/test';

export async function login(page: Page, user: string, password: string): Promise<void> {
  // Example for a classic user name + password form (replace with your app's steps):
  // await page.getByLabel('User name').fill(user);
  // await page.getByLabel('Password').fill(password);
  // await page.getByRole('button', { name: 'Sign in' }).click();
  void user; void password;
  throw new Error('tests/login.ts: write login() for your app (run /setup-login), or leave "Login as" empty in the Excel.');
}

export async function expectLoggedIn(page: Page): Promise<void> {
  // Example: something that exists only for a logged-in user:
  // await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  void page; void expect;
  throw new Error('tests/login.ts: write expectLoggedIn() for your app (run /setup-login).');
}
