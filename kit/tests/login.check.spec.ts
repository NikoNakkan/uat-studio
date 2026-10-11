// Login check (F2): proves that tests/login.ts logs one account in. Run only through
// .github/skills/setting-up-login/scripts/check_login.py, which sets UAT_LOGIN_AS per account and
// prints OK or FAIL without any secret. Not part of a UAT run's results (the progress reporter skips it).
import { test } from './fixtures';
import { expectLoggedIn } from './login';

test('login check', async ({ page }) => {
  if (!process.env.UAT_LOGIN_AS) throw new Error('UAT_LOGIN_AS is not set: run check_login.py');
  await page.goto(process.env.START_PAGE ?? '/');
  await expectLoggedIn(page);
});
