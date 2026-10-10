import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Interaction } from '../api';
import { Activity } from '../components/Activity';
import { NeedsYou } from '../components/NeedsYou';
import { Button, Card, Field, Loading, Notice, Pill, Pre, QueryGate, Table, errorText, inputCls, useEvents, useTitle } from '../ui';

function fixFor(fix: string): string | null {
  if (fix.includes('init-agents')) return 'init-agents';
  if (fix.includes('playwright install')) return 'playwright-chromium';
  if (fix.includes('npm install')) return 'npm-install';
  if (fix.includes('pip install')) return 'pip-install';
  return null;
}

export function SetupPage() {
  useTitle('Setup');
  const qc = useQueryClient();
  const check = useQuery({ queryKey: ['setup'], queryFn: () => api.get<any>('/api/setup') });
  const env = useQuery({ queryKey: ['env'], queryFn: () => api.get<any>('/api/env') });
  const appOpen = useQuery({ queryKey: ['interactions', 'app'], queryFn: () => api.get<Interaction[]>('/api/interactions?channel=app'), refetchInterval: 2500 });
  const { events, live } = useEvents('/api/events/app', [['interactions', 'app']]);
  const [confirm, setConfirm] = useState<{ id: string; text: string } | null>(null);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [job, setJob] = useState<string | null>(null);
  const lock = useRef(false);

  const run = async (label: string, fn: () => Promise<any>) => {
    if (lock.current) return;
    lock.current = true;
    setJob(label); setError('');
    try { const r = await fn(); if (r?.output) setOutput(r.output); qc.invalidateQueries(); } catch (e) { setError(errorText(e)); } finally { lock.current = false; setJob(null); }
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <div>
        <h1 className="text-xl font-semibold">Setup</h1>
        <p className="text-sm text-muted">Everything the flow needs on this machine, the app under test, its test accounts, and how the tests log in.</p>
      </div>
      {appOpen.isPending ? <Loading label="Checking what needs you…" /> : appOpen.isError ? <Notice>{errorText(appOpen.error)}</Notice> : <NeedsYou items={appOpen.data ?? []} />}

      <Card title="Requirements" actions={<Button busy={check.isFetching && !job} onClick={() => qc.invalidateQueries({ queryKey: ['setup'] })}>{check.isFetching && !job ? 'Checking…' : 'Check again'}</Button>}>
        <QueryGate pending={check.isPending} error={check.isError ? check.error : null} label="Checking this machine…">
          <Table head={['', 'Requirement', 'Fix']} rows={(check.data?.rows ?? []).map((row: any) => {
            const id = fixFor(row.fix);
            return [<Pill value={row.status} />, row.item, id
              ? <Button disabled={!!job} onClick={() => setConfirm({ id, text: row.fix })}>Fix: {row.fix}</Button>
              : <span className="text-sm text-muted">{row.fix}</span>];
          })} />
        </QueryGate>
        {confirm && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warn/60 p-3 text-sm">
            <span>This installs software on this machine: <code className="font-mono">{confirm.text}</code>. Run it now?</span>
            <Button kind="primary" busy={!!job} onClick={() => { const c = confirm; setConfirm(null); run(c.text, () => api.post('/api/setup/fix', { id: c.id })); }}>Yes, run it</Button>
            <Button disabled={!!job} onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        )}
        {job && job !== 'login setup' && job !== 'login check' && <div className="mt-3"><Loading label={`Running ${job}…`} /></div>}
      </Card>

      {env.isPending ? <Card title="App under test"><Loading label="Loading the app under test…" /></Card>
        : env.isError ? <Card title="App under test"><Notice>{errorText(env.error)}</Notice></Card>
        : <AppUnderTest env={env.data} onSaved={() => qc.invalidateQueries({ queryKey: ['env'] })} />}
      {env.isPending ? <Card title="Test accounts"><Loading label="Loading test accounts…" /></Card>
        : env.isError ? null
        : <Accounts env={env.data} onSaved={() => qc.invalidateQueries({ queryKey: ['env'] })} />}

      <Card title="Login" actions={<>
        <Button kind="primary" busy={job === 'login setup'} disabled={!!job} onClick={() => run('login setup', () => api.post('/api/setup/login'))}>{job === 'login setup' ? 'Starting…' : 'Set up login with AI'}</Button>
        <Button busy={job === 'login check'} disabled={!!job} onClick={() => run('login check', () => api.post('/api/setup/check-login'))}>{job === 'login check' ? 'Checking…' : 'Check every account logs in'}</Button>
      </>}>
        <p className="mb-3 text-sm text-muted">Login is code, not AI: tests/login.ts is written once (the login-setup agent asks which kind of login the app has, maps the login page with Playwright's planner, and writes it), then every test logs in through it. The agent never sees a password.</p>
        {(job === 'login setup' || job === 'login check') && <div className="mb-3"><Loading label={job === 'login setup' ? 'Setting up login…' : 'Checking every account…'} /></div>}
        <Activity events={events} live={live} />
      </Card>
      {output && <Card title="Last output"><Pre>{output}</Pre></Card>}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}

function AppUnderTest({ env, onSaved }: { env: any; onSaved: () => void }) {
  const [start, setStart] = useState<string | null>(null);
  const [origins, setOrigins] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  if (!env) return null;
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setSaving(true); setMsg('');
    try {
      if (start !== null) await api.put('/api/env', { key: 'START_PAGE', value: start });
      if (origins !== null) await api.put('/api/guardrails/origins', { origins: origins.split(/[\s,]+/).filter(Boolean) });
      setMsg('Saved.'); onSaved();
    } catch (e) { setMsg(errorText(e)); }
    finally { lock.current = false; setSaving(false); }
  };
  return (
    <Card title="App under test" actions={<Button kind="primary" busy={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Start page (START_PAGE in .env)" hint="Where every test starts.">
          <input className={inputCls} value={start ?? env.start_page} onChange={e => setStart(e.target.value)} placeholder="https://test.app.example.com" />
        </Field>
        <Field label="Allowed sites (config/guardrails.yaml)" hint="The only sites the browser may open. One per line, scheme and host only.">
          <textarea className={`${inputCls} font-mono`} rows={3} value={origins ?? env.allowed_origins.join('\n')} onChange={e => setOrigins(e.target.value)} />
        </Field>
      </div>
      {msg && <div className="mt-2"><Notice tone={msg === 'Saved.' ? 'good' : 'bad'}>{msg}</Notice></div>}
    </Card>
  );
}

function Accounts({ env, onSaved }: { env: any; onSaved: () => void }) {
  const [label, setLabel] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const lock = useRef(false);
  if (!env) return null;
  const set = async (key: string) => {
    if (lock.current) return;
    lock.current = true;
    setSaving(key); setMsg('');
    try { await api.put('/api/env', { key, value: values[key] ?? '' }); setValues({ ...values, [key]: '' }); setMsg(`${key} saved.`); onSaved(); }
    catch (e) { setMsg(errorText(e)); }
    finally { lock.current = false; setSaving(null); }
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
            <Button busy={saving === key} disabled={!values[key] || !!saving || adding} onClick={() => set(key)}>{saving === key ? 'Saving…' : 'Save'}</Button>
          </div>;
        }),
      ])} />
      <div className="mt-3 flex flex-wrap gap-2">
        <input className={`${inputCls} max-w-xs`} placeholder="New account, e.g. Manager test account" value={label} disabled={adding} onChange={e => setLabel(e.target.value)} />
        <Button busy={adding} disabled={!label.trim() || !!saving} onClick={async () => {
          if (lock.current) return;
          lock.current = true;
          setAdding(true); setMsg('');
          try { await api.post('/api/env/accounts', { label }); setLabel(''); setMsg('Account added.'); onSaved(); }
          catch (e) { setMsg(errorText(e)); }
          finally { lock.current = false; setAdding(false); }
        }}>{adding ? 'Adding…' : 'Add account'}</Button>
      </div>
      {msg && <div className="mt-2"><Notice tone={msg.endsWith('saved.') || msg === 'Account added.' ? 'good' : 'bad'}>{msg}</Notice></div>}
    </Card>
  );
}
