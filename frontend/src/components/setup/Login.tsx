import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Event } from '../../api';
import { useAction } from '../../lib/useAction';
import { Button, Notice, Pre } from '../../ui';
import { ExcelPicker } from '../ExcelPicker';

/** Login setup is running from its agent's start until that agent ends, fails, or is stopped. */
export function loginRunning(events: Event[]): boolean {
  let running = false;
  for (const e of events) {
    if (e.type === 'agent_start' && e.agent === 'uat-login-setup') running = true;
    else if ((e.type === 'agent_end' && e.agent === 'uat-login-setup') || (e.type === 'agent_error' && e.stage === 'setup-login')
      || (e.type === 'note' && /^Login setup (finished|stopped)/.test(e.text ?? ''))) running = false;
  }
  return running;
}

/** Start, stop and check the login agent, which writes tests/login.ts once per app. */
export function Login({ running, written }: { running: boolean; written: boolean }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [output, setOutput] = useState('');
  const { busy, error, run } = useAction();
  const go = (name: string, fn: () => Promise<{ output?: string } | undefined>) => run(name, async () => {
    const r = await fn();
    if (r?.output) setOutput(r.output);
    qc.invalidateQueries();
  });
  const start = () => go('setup', () => {
    const form = new FormData();
    if (file) form.append('file', file);
    return api.post('/api/setup/login', form);
  });
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">Login is code, not AI. The login agent looks at your login page with Playwright and reads your test cases
        (which accounts log in, and what a logged-in user sees), asks only what neither tells it, writes tests/login.ts and proves every account
        logs in. From then on every test logs in through that code. The agent never sees a password.
        What it says, and every command it runs, stays in the live panel.</p>
      <ExcelPicker label="Test cases the agent reads" file={file} onFile={setFile} disabled={running || !!busy}
        emptyHint="Choose the Excel you will test with: it tells the agent which accounts log in and what they see." />
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" busy={busy === 'setup' || running} disabled={!!busy || running} onClick={start}>
          {running ? 'Login agent working…' : busy === 'setup' ? 'Starting…' : written ? 'Set up login again' : 'Set up login with AI'}
        </Button>
        {running && <Button kind="danger" busy={busy === 'stop'} disabled={busy === 'stop'} onClick={() => go('stop', () => api.post('/api/setup/login/stop'))}>
          {busy === 'stop' ? 'Stopping…' : 'Stop'}</Button>}
        <Button busy={busy === 'check'} disabled={!!busy || running} onClick={() => go('check', () => api.post('/api/setup/check-login'))}>
          {busy === 'check' ? 'Checking every account…' : 'Check every account logs in'}</Button>
      </div>
      {output && <Pre className="max-h-40 overflow-y-auto">{output}</Pre>}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
