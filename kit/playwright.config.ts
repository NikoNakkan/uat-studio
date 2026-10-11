import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// START_PAGE and the test accounts come from the environment: UAT Studio hands them to the tests while they run
// (never a file in the project, never read by agents). On your own, set them in the shell before running.
// process.loadEnvFile needs Node 20.12+ (check_setup.py checks this).

// scripts/run_tests.py sets these so every run keeps its own evidence in runs/<run-id>/.
// Without them (Playwright's agents, npm test by hand) everything goes to runs/current/, a scratch
// folder that is never a run: the progress reporter writes nothing there.
const runDir = path.resolve(process.env.UAT_RUN_DIR ?? 'runs/current');
const evidenceDir = path.resolve(process.env.UAT_EVIDENCE_DIR ?? path.join(runDir, 'evidence'));
const ms = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/_removed/**',   // tests of cases removed from the Excel: kept for reference, never run
  outputDir: path.join(evidenceDir, 'test-output'),
  workers: 1,       // UAT environments are shared: one test at a time until test data isolation (F1) exists
  retries: 0,       // a retry would hide an unreliable test; flakiness is checked on purpose (decision 30)
  forbidOnly: true,
  // UAT environments are often slow. Both can be raised with environment variables without touching this file.
  timeout: ms('UAT_TEST_TIMEOUT_MS', 60_000),
  expect: { timeout: ms('UAT_EXPECT_TIMEOUT_MS', 10_000) },
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(evidenceDir, 'results.json') }],
    ['html', { outputFolder: path.join(evidenceDir, 'report'), open: 'never' }],
    ['./scripts/progress-reporter.ts'],   // saves each result to progress.json as soon as a test ends (decision 22)
  ],
  use: {
    baseURL: process.env.START_PAGE,
    trace: 'on',                     // every test: step-through recording (decision 19)
    video: process.env.UAT_VIDEO === '0' ? 'off' : 'retain-on-failure',   // video only when a test fails (switchable)
    screenshot: 'only-on-failure',   // plus one screenshot per step via shot(N) in each test
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // More browsers and screen sizes: future feature F9.
  ],
});
