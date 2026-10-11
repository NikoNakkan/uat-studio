// Browser check of tests/canvas.ts against a fake canvas player (site/). No Power Apps tenant needed.
// Run from the kit folder: npm run selftest:canvas
import { defineConfig } from '@playwright/test';
import path from 'node:path';

process.env.UAT_RUN_DIR ??= path.join(__dirname, '.run');   // the fixture's screenshots stay out of runs/

export default defineConfig({
  testDir: __dirname,
  outputDir: path.join(__dirname, '.run', 'out'),
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4199', trace: 'off' },
  webServer: {
    command: `python -m http.server 4199 --bind 127.0.0.1 --directory "${path.join(__dirname, 'site')}"`,
    url: 'http://127.0.0.1:4199/index.html',
    reuseExistingServer: true,
  },
});
