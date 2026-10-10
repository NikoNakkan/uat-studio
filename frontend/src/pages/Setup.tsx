import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Interaction } from '../api';
import { Activity } from '../components/Activity';
import { NeedsYou } from '../components/NeedsYou';
import { Button, Card, Empty, Field, Pill, Pre, Table, errorText, inputCls, useEvents } from '../ui';

function fixFor(fix: string): string | null {
  if (fix.includes('init-agents')) return 'init-agents';
  if (fix.includes('playwright install')) return 'playwright-chromium';
  if (fix.includes('npm install')) return 'npm-install';
  if (fix.includes('pip install')) return 'pip-install';
  return null;
}

export function SetupPage() {
  const qc = useQueryClient();
  const check = useQuery({ queryKey: ['setup'], queryFn: () => api.get<any>('/api/setup') });
  const env = useQuery({ queryKey: ['env'], queryFn: () => api.get<any>('/api/env') });
  const appOpen = useQuery({ queryKey: ['interactions', 'app'], queryFn: () => api.get<Interaction[]>('/api/interactions?channel=app'), refetchInterval: 2500 });
  const events = useEvents('/api/events/app', [['interactions', 'app']]);
  const [confirm, setConfirm] = useState<{ id: string; text: string } | null>(null);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setError('');
    try { const r = await fn(); if (r?.output) setOutput(r.output); qc.invalidateQueries(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <div>
        <h1 className="text-xl font-semibold">Setup</h1>
        <p className="text-sm text-muted">Everything the flow needs on this machine, the app under test, its test accounts, and how the tests log in.</p>
      </div>
      <NeedsYou items={appOpen.data ?? []} />

      <Card title="Requirements" actions={<Button onClick={() => qc.invalidateQueries({ queryKey: ['setup'] })}>Check again</Button>}>
        {check.isLoading ? <Empty>Checking…</Empty> : (
          <Table head={['', 'Requirement', 'Fix']} rows={(check.data?.rows ?? []).map((row: any) => {
            const id = fixFor(row.fix);
            return [<Pill value={row.status} />, row.item, id
              ? <Button disabled={busy} onClick={() => setConfirm({ id, text: row.fix })}>Fix: {row.fix}</Button>
              : <span className="text-sm text-muted">{row.fix}</span>];
          })} />
        )}
        {confirm && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warn/60 p-3 text-sm">
            <span>This installs software on this machine: <code className="font-mono">{confirm.text}</code>. Run it now?</span>
            <Button kind="primary" disabled={busy} onClick={() => { const c = confirm; setConfirm(null); run(() => api.post('/api/setup/fix', { id: c.id })); }}>Yes, run it</Button>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        )}
      </Card>

      <AppUnderTest env={env.data} onSaved={() => qc.invalidateQueries({ queryKey: ['env'] })} />
      <Accounts env={env.data} onSaved={() => qc.invalidateQueries({ queryKey: ['env'] })} />

      <Card title="Login" actions={<>
        <Button kind="primary" disabled={busy} onClick={() => run(() => api.post('/api/setup/login'))}>Set up login with AI</Button>
        <Button disabled={busy} onClick={() => run(() => api.post('/api/setup/check-login'))}>Check every account logs in</Button>
      </>}>
        <p className="mb-3 text-sm text-muted">Login is code, not AI: tests/login.ts is written once (the login-setup agent asks which kind of login the app has, maps the login page with Playwright's planner, and writes it), then every test logs in through it. The agent never sees a password.</p>
        <Activity events={events} />
      </Card>
      {output && <Card title="Last output"><Pre>{output}</Pre></Card>}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

function AppUnderTest({ env, onSaved }: { env: any; onSaved: () => void }) {
  const [start, setStart] = useState<string | null>(null);
  const [origins, setOrigins] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  if (!env) return null;
  const save = async () => {
    setMsg('');
    try {
      if (start !== null) await api.put('/api/env', { key: 'START_PAGE', value: start });
      if (origins !== null) await api.put('/api/guardrails/origins', { origins: origins.split(/[\s,]+/).filter(Boolean) });
      setMsg('Saved.'); onSaved();
    } catch (e) { setMsg(errorText(e)); }
  };
  return (
    <Card title="App under test" actions={<Button kind="primary" onClick={save}>Save</Button>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Start page (START_PAGE in .env)" hint="Where every test starts.">
          <input className={inputCls} value={start ?? env.start_page} onChange={e => setStart(e.target.value)} placeholder="https://test.app.example.com" />
        </Field>
        <Field label="Allowed sites (config/guardrails.yaml)" hint="The only sites the browser may open. One per line, scheme and host only.">
          <textarea className={`${inputCls} font-mono`} rows={3} value={origins ?? env.allowed_origins.join('\n')} onChange={e => setOrigins(e.target.value)} />
        </Field>
      </div>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </Card>
  );
}

function Accounts({ env, onSaved }: { env: any; onSaved: () => void }) {
  const [label, setLabel] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  if (!env) return null;
  const set = async (key: string) => {
    setMsg('');
    try { await api.put('/api/env', { key, value: values[key] ?? '' }); setValues({ ...values, [key]: '' }); setMsg(`${key} saved.`); onSaved(); }
    catch (e) { setMsg(errorText(e)); }
  };
  return (
    <Card title="Test accounts (.env)">
      <p className="mb-3 text-sm text-muted">The Excel's "Login as" column names an account in plain words. Values are written to the private .env file and never shown again, never sent to the AI, and never committed.</p>
      <Table head={['Account', 'User', 'Password']} rows={env.accounts.map((a: any) => [
        <span className="font-mono text-xs">{a.name}</span>,
        ...(['USER', 'PASSWORD'] as const).map(part => {
          const key = `${a.name}_${part}`;
          const isSet = part === 'USER' ? a.user_set : a.password_set;
          return <div className="flex gap-1.5">
            <input aria-label={key} type={part === 'PASSWORD' ? 'password' : 'text'} autoComplete="off" className={inputCls}
              placeholder={isSet ? 'set (type to replace)' : 'not set'} value={values[key] ?? ''} onChange={e => setValues({ ...values, [key]: e.target.value })} />
            <Button disabled={!values[key]} onClick={() => set(key)}>Save</Button>
          </div>;
        }),
      ])} />
      <div className="mt-3 flex flex-wrap gap-2">
        <input className={`${inputCls} max-w-xs`} placeholder="New account, e.g. Manager test account" value={label} onChange={e => setLabel(e.target.value)} />
        <Button disabled={!label.trim()} onClick={async () => { await api.post('/api/env/accounts', { label }); setLabel(''); onSaved(); }}>Add account</Button>
      </div>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </Card>
  );
}
