// Playwright reporter: writes each test's result into runs/<run-id>/progress.json the moment the
// test ends, so a stopped run continues where it left off (decision 22). No AI involved.
// Does nothing when UAT_RUN_DIR is not set (Playwright's agents running tests through the MCP server,
// npm test by hand) or when UAT_PROGRESS=0 (flakiness and reproduction runs): only scripts/run_tests.py
// writes results into a run.
import fs from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const stripColours = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
// Seeds (tests/seed.spec.ts, tests/seeds/*.seed.spec.ts) and the login check are not test cases
const notACase = (file: string) => /seed\.spec\.ts$/.test(file) || /login\.check\.spec\.ts$/.test(file);

class ProgressReporter implements Reporter {
  private runDir = process.env.UAT_RUN_DIR ? path.resolve(process.env.UAT_RUN_DIR) : '';
  private file = this.runDir ? path.join(this.runDir, 'progress.json') : '';
  private evidence = this.runDir
    ? path.relative(this.runDir, path.resolve(process.env.UAT_EVIDENCE_DIR ?? path.join(this.runDir, 'evidence')))
    : '';

  onTestEnd(test: TestCase, result: TestResult) {
    if (!this.runDir || process.env.UAT_PROGRESS === '0' || notACase(path.basename(test.location.file))) return;
    const progress = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf-8')) : {};
    progress.tests ??= {};
    progress.tests[test.title.split(' ')[0]] = {
      result: result.status,                               // passed | failed | timedOut | skipped | interrupted
      file: path.relative(process.cwd(), test.location.file).replace(/\\/g, '/'),
      error: result.error?.message ? stripColours(result.error.message).split('\n')[0] : '',
      duration_ms: result.duration,
      evidence: this.evidence.replace(/\\/g, '/'),         // folder in the run holding this test's latest evidence
      at: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(progress, null, 2));
  }

  printsToStdio() {
    return false;
  }
}

export default ProgressReporter;
