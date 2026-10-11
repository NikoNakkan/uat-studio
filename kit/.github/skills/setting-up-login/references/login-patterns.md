# Login patterns

What a login can look like on the app under test, and how the kit handles each. The uat-login-setup
agent asks the person which of these the app has (one or several), then writes `tests/login.ts`
for the supported ones. The planner records the elements of the login page in the app map under
a page called `login`; `tests/login.ts` must use those exact role + name pairs.

| # | Pattern | What is on screen | Kit support | How it is handled |
| --- | --- | --- | --- | --- |
| 1 | User name + password form | Two fields and a sign-in button on one page | Yes | `login()` fills both and clicks. Values from the environment only. |
| 2 | Two-step form | First a user name (or email) and Next, then a password | Yes | `login()` fills, clicks Next, waits for the password field, fills, clicks. |
| 3 | Login behind a button | The start page shows "Sign in"; the form appears after a click or on another page | Yes | `login()` clicks first, then as 1 or 2. |
| 4 | Role or tenant picker after login | "Choose your organisation / role" before the app opens | Yes, with one value | A third account value `<ACCOUNT>_TENANT` (plain text, not a secret); `login()` chooses it. The agent asks for the exact option text. |
| 5 | Cookie or consent banner | A banner must be dismissed before anything works | Yes | `login()` dismisses it when present (`if` is allowed in login.ts, not in tests). |
| 6 | "Remember this device" / stay signed in | A checkbox on the form | Yes | Ticked when present; it only helps session reuse. |
| 7 | Forced password change / first-login wizard | The account is asked to set a new password | No | Never automated: the person prepares the test account so this does not appear. |
| 8 | TOTP code (authenticator app) | A 6-digit code after the password | Not yet (F4) | Needs the account's TOTP secret as an account value and a generator in login.ts. Until then: the person disables MFA for the test accounts, or captures a session (pattern 11). |
| 9 | SMS or email one-time code | A code sent elsewhere | Not yet (F4, F5) | Same as 8; a test inbox (F5) can read email codes later. |
| 10 | Magic link | "We sent you a link" | Not yet (F5) | Needs a test inbox. |
| 11 | SSO / OAuth (Microsoft, Google, Okta...) | A button that leaves the site for an identity provider | Partly | The guard hook blocks other sites, and providers block automation. Supported path: a person logs in once by hand in a Playwright browser and saves the session (`npx playwright codegen --save-storage`); the file is copied to `runs/<run-id>/auth/<ACCOUNT>.json`. The kit reuses it until it expires. Or set the `<ACCOUNT>_STORAGE_STATE` environment variable to the saved file (pattern 15). |
| 12 | CAPTCHA | A puzzle | No | The UAT environment must switch it off for the test accounts. |
| 13 | Session expiry during a run | The app logs out after N minutes | Yes | `UAT_SESSION_MAX_AGE_MIN` (environment) makes the fixture log in again after that time. If the app logs out mid-test, the test fails as `environment`. |
| 14 | No login at all | The start page is the app | Yes | Leave "Login as" empty in the Excel; nothing runs. |
| 15 | Microsoft Entra ID (Power Apps, Dynamics 365, SharePoint) | login.microsoftonline.com: email, Next, password, Sign in, then "Stay signed in?" | Yes | Without MFA: `login()` as pattern 2, then clicks "No" on "Stay signed in?" when it shows. Add `https://login.microsoftonline.com` to allowed_origins. With MFA or certificate sign-in: sign in with Microsoft's tool (`npm run auth:headful` in `power-platform-playwright-samples/packages/e2e-tests`, package `playwright-ms-auth`), then set the `<ACCOUNT>_STORAGE_STATE` environment variable to the saved `.playwright-ms-auth/state-<email>.json`. The fixture uses that session as it is and never runs `login()` for the account; the session lasts about 24 hours. Tests for canvas apps follow the testing-canvas-apps skill. |

Rules for every pattern:
- `login()` and `expectLoggedIn()` are the only code that knows about login. Tests never type a user name or password; `check_tests.py` rejects a test that does.
- `expectLoggedIn()` checks something only a logged-in user sees (a "Sign out" button, the user's menu, the first page of the app). It must not check the login page itself.
- Element names come from the app map (`app-map/app-map.yaml`, page `login`), never guessed.
- Values that are not secrets (tenant name, role) are account values too, so the Excel only ever names the account in plain words.
