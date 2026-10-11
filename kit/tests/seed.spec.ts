// Playwright's seed test: the planner and generator run it to set up the page before each case,
// and copy its shape (imports, fixtures) into every generated test.
//
// Login is NOT written here. It lives in tests/login.ts and is applied by the loginAs fixture
// (tests/fixtures.ts), so that generated tests log in at run time too. This seed logs in when
// UAT_LOGIN_AS names an account; the per-account seeds in tests/seeds/ (written by excel_to_plan.py)
// set loginAs themselves, one per account the Excel uses.
import { test } from './fixtures';

test('seed', async ({ page }) => {
  await page.goto(process.env.START_PAGE ?? '/');
});
