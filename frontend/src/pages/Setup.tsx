import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Event, type Interaction } from '../api';
import { Activity } from '../components/Activity';
import { Stepper, type StepDef, type StepState } from '../components/Stepper';
import { Button, Field, Loading, MsgNotice, Notice, Pill, Pre, QueryGate, Table, errorText, fail, inputCls, ok, useEvents, useTitle, type Msg } from '../ui';

function fixFor(fix: string): string | null {
  if (fix.includes('init-agents')) return 'init-agents';
  if (fix.includes('playwright install')) return 'playwright-chromium';
  if (fix.includes('npm install')) return 'npm-install';
  if (fix.includes('pip install')) return 'pip-install';
  return null;
}

const LOGIN_TEMPLATE = 'write login() for your app';

/** Login setup is running from its agent's start until that agent ends or the setup fails. */
function loginRunning(events: Event[]) {
  let running = false;
  for (const e of events) {
    if (e.type === 'agent_start' && e.agent === 'uat-login-setup') running = true;
    else if ((e.type === 'agent_end' && e.agent === 'uat-login-setup') || (e.type === 'agent_error' && e.stage === 'setup-login')
      || (e.type === 'note' && e.text?.startsWith('Login setup finished'))) running = false;
  }
  return running;
}

export function SetupPage() {
  useTitle('Setup');
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<any>('/api/settings') });
  const check = useQuery({ queryKey: ['setup'], queryFn: () => api.get<any>('/api/setup') });
  const env = useQuery({ queryKey: ['env'], queryFn: () => api.get<any>('/api/env') });
  const loginTs = useQuery({ queryKey: ['kittext', 'tests/login.ts'], queryFn: () => api.get<{ text: string }>('/api/kit/text?path=tests%2Flogin.ts'), refetchInterval: 5000 });
  const open = useQuery({ queryKey: ['interactions'], queryFn: () => api.get<Interaction[]>('/api/interactions'), refetchInterval: 3000 });
  const { events, live } = useEvents('/api/events/app', [['interactions']]);

  const rows: any[] = check.data?.rows ?? [];
  const machineOk = !!check.data && rows.every(r => r.status === 'OK' || r.status === 'INFO');
  const accounts: any[] = env.data?.accounts ?? [];
  const accountsOk = accounts.length > 0 && accounts.every(a => a.user_set && a.password_set);
  const loginWritten = !!loginTs.data && !loginTs.data.text.includes(LOGIN_TEMPLATE);
  const loginWaiting = (open.data ?? []).some(i => i.channel === 'app');
  const running = useMemo(() => loginRunning(events), [events]);

  const state = (done: boolean, pending: boolean): StepState => (pending ? 'todo' : done ? 'done' : 'current');
  const steps: StepDef[] = [
    {
      id: 'key', title: 'Anthropic API key', state: state(!!settings.data?.api_key_set, settings.isPending),
      summary: settings.data?.api_key_set ? `Saved (ends ${settings.data.api_key_hint})` : 'The AI agents need it. It stays on this machine.',
      body: <ApiKey settings={settings.data} onSaved={() => qc.invalidateQueries({ queryKey: ['settings'] })} />,
    },
    {
      id: 'machine', title: 'This machine', state: state(machineOk, check.isPending),
      summary: check.isPending ? 'Checking…' : machineOk ? 'Node.js, Playwright, Python and the kit are ready.' : 'Something is missing. Open to fix it.',
      body: <Machine check={check} rows={rows} />,
    },
    {
      id: 'app', title: 'App under test', state: state(!!env.data?.start_page, env.isPending),
      summary: env.data?.start_page ? env.data.start_page : 'Where the tests start, and the only sites the browser may open.',
      body: env.isError ? <Notice>{errorText(env.error)}</Notice> : env.data ? <AppUnderTest env={env.data} onSaved={() => qc.invalidateQueries({ queryKey: ['env'] })} /> : <Loading />,
    },
    {
      id: 'accounts', title: 'Test accounts', state: state(accountsOk, env.isPending),
      summary: accounts.length ? accounts.map(a => `${a.name}${a.user_set && a.password_set ? '' : ' (incomplete)'}`).join(' · ') : 'The accounts the Excel names in "Login as".',
      body: env.data ? <Accounts env={env.data} onSaved={() => qc.invalidateQueries({ queryKey: ['env'] })} /> : <Loading />,
    },
    {
      id: 'login', title: 'How the tests log in',
      state: loginTs.isPending ? 'todo' : loginWaiting ? 'waiting' : running ? 'current' : loginWritten ? 'done' : 'current',
      summary: loginWaiting ? 'The login agent asked you something. Answer below.' : running ? 'The login agent is working…'
        : loginWritten ? 'tests/login.ts is written.' : 'The login agent writes tests/login.ts once, by looking at your login page.',
      body: <Login events={events} live={live} running={running} written={loginWritten} />,
    },
  ];
  const allDone = steps.every(s => s.state === 'done');

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <div>
        <h1 className="text-xl font-semibold">Set up</h1>
        <p className="text-sm text-muted">Once per machine and app. Each step opens when it is its turn.</p>
      </div>
      <Stepper label="Setup steps" steps={steps} />
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 ${allDone ? 'border-good/60 bg-good/5' : 'border-line bg-surface'}`}>
        <div>
          <div className="font-semibold">{allDone ? 'Ready to test' : 'Next: a test run'}</div>
          <div className="text-sm text-muted">{allDone ? 'Upload your Excel of test cases and start a run.' : 'Finish the steps above first.'}</div>
        </div>
        <Link to="/" className={`rounded-md px-3 py-1.5 text-sm font-medium ${allDone ? 'bg-accent text-accent-ink' : 'border border-line bg-surface text-muted'}`}>Go to test runs →</Link>
      </div>
    </div>
  );
}

function ApiKey({ settings, onSaved }: { settings: any; onSaved: () => void }) {
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setMsg(null);
    try { await fn(); } catch (e) { setMsg(fail(e)); } finally { setBusy(null); }
  };
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">From console.anthropic.com → API Keys. It is saved in your home folder and never shown again, only its last characters.</p>
      <div className="flex flex-wrap gap-2">
        <input type="password" autoComplete="off" aria-label="API key" className={`${inputCls} max-w-md`} placeholder={settings?.api_key_set ? 'Saved. Paste a new one to replace it.' : 'sk-ant-…'}
          value={key} onChange={e => setKey(e.target.value)} />
        <Button kind="primary" busy={busy === 'save'} disabled={!key.trim() || !!busy} onClick={() => act('save', async () => {
          await api.put('/api/settings', { api_key: key.trim() }); setKey(''); setMsg(ok('Saved.')); onSaved();
        })}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
        {settings?.api_key_set && <Button busy={busy === 'test'} disabled={!!busy} onClick={() => act('test', async () => {
          const r = await api.post<{ ok: boolean; answer?: string; model?: string }>('/api/settings/test');
          setMsg(r.ok ? ok(`The key works (${r.model}).`) : { text: 'The key was refused.', ok: false });
        })}>{busy === 'test' ? 'Testing…' : 'Test the key'}</Button>}
      </div>
      <MsgNotice msg={msg} className="" />
      <p className="text-xs text-muted">Models per agent and other options: <Link className="text-accent hover:underline" to="/settings">Settings</Link>.</p>
    </div>
  );
}

function Machine({ check, rows }: { check: any; rows: any[] }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<{ id: string; text: string } | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const fix = async (c: { id: string; text: string }) => {
    setConfirm(null); setJob(c.text); setError('');
    try { const r = await api.post<any>('/api/setup/fix', { id: c.id }); setOutput(r?.output ?? ''); qc.invalidateQueries({ queryKey: ['setup'] }); }
    catch (e) { setError(errorText(e)); } finally { setJob(null); }
  };
  return (
    <div className="grid gap-3">
      <QueryGate pending={check.isPending} error={check.isError ? check.error : null} label="Checking this machine…">
        <Table head={['', 'Requirement', 'Fix']} rows={rows.map((row: any) => {
          const id = fixFor(row.fix);
          return [<Pill value={row.status} />, row.item, id
            ? <Button disabled={!!job} onClick={() => setConfirm({ id, text: row.fix })}>Fix: {row.fix}</Button>
            : <span className="text-sm text-muted">{row.fix}</span>];
        })} />
      </QueryGate>
      {confirm && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warn/60 p-3 text-sm">
          <span>This installs software on this machine: <code className="font-mono">{confirm.text}</code>. Run it now?</span>
          <Button kind="primary" onClick={() => fix(confirm)}>Yes, run it</Button>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
        </div>
      )}
      {job && <Loading label={`Running ${job}…`} />}
      {output && <Pre className="max-h-64 overflow-y-auto">{output}</Pre>}
      {error && <Notice>{error}</Notice>}
      <div><Button busy={check.isFetching} onClick={() => qc.invalidateQueries({ queryKey: ['setup'] })}>{check.isFetching ? 'Checking…' : 'Check again'}</Button></div>
    </div>
  );
}

function Login({ events, live, running, written }: { events: Event[]; live: any; running: boolean; written: boolean }) {
  const qc = useQueryClient();
  const [job, setJob] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const lock = useRef(false);
  const go = async (label: string, fn: () => Promise<any>) => {
    if (lock.current) return;
    lock.current = true;
    setJob(label); setError('');
    try { const r = await fn(); if (r?.output) setOutput(r.output); qc.invalidateQueries(); } catch (e) { setError(errorText(e)); }
    finally { lock.current = false; setJob(null); }
  };
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">Login is code, not AI. The login agent looks at your login page with Playwright and reads your test cases
        (which accounts log in, and what a logged-in user sees), asks only what neither tells it, writes tests/login.ts and proves every account
        logs in. From then on every test logs in through that code. The agent never sees a password.</p>
      <Field label="Your test cases" hint="The Excel you will test with. Without it, the agent uses the newest Excel you uploaded for a run.">
        <input type="file" accept=".xlsx" disabled={running || !!job} onChange={e => setFile(e.target.files?.[0] ?? null)}
          className={`${inputCls} max-w-md file:mr-3 file:rounded file:border-0 file:bg-accent-soft file:px-2 file:py-1 file:text-sm file:font-medium file:text-ink`} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" busy={job === 'setup' || running} disabled={!!job || running}
          onClick={() => go('setup', () => { const form = new FormData(); if (file) form.append('file', file); return api.post('/api/setup/login', form); })}>
          {running ? 'Login agent working…' : job === 'setup' ? 'Starting…' : written ? 'Set up login again' : 'Set up login with AI'}
        </Button>
        <Button busy={job === 'check'} disabled={!!job || running} onClick={() => go('check', () => api.post('/api/setup/check-login'))}>
          {job === 'check' ? 'Checking every account…' : 'Check every account logs in'}</Button>
      </div>
      {output && <Pre className="max-h-64 overflow-y-auto">{output}</Pre>}
      {error && <Notice>{error}</Notice>}
      <Activity events={events} live={live} />
    </div>
  );
}

function AppUnderTest({ env, onSaved }: { env: any; onSaved: () => void }) {
  const [start, setStart] = useState<string | null>(null);
  const [origins, setOrigins] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setSaving(true); setMsg(null);
    try {
      if (start !== null) await api.put('/api/env', { key: 'START_PAGE', value: start });
      if (origins !== null) await api.put('/api/guardrails/origins', { origins: origins.split(/[\s,]+/).filter(Boolean) });
      setMsg(ok('Saved.')); onSaved();
    } catch (e) { setMsg(fail(e)); }
    finally { lock.current = false; setSaving(false); }
  };
  return (
    <div className="grid gap-3">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Start page" hint="Where every test starts (START_PAGE in .env).">
          <input className={inputCls} value={start ?? env.start_page} onChange={e => setStart(e.target.value)} placeholder="https://test.app.example.com" />
        </Field>
        <Field label="Allowed sites" hint="The only sites the browser may open. One per line, scheme and host only.">
          <textarea className={`${inputCls} font-mono`} rows={3} value={origins ?? env.allowed_origins.join('\n')} onChange={e => setOrigins(e.target.value)} />
        </Field>
      </div>
      <div><Button kind="primary" busy={saving} disabled={start === null && origins === null} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button></div>
      <MsgNotice msg={msg} className="" />
    </div>
  );
}

function Accounts({ env, onSaved }: { env: any; onSaved: () => void }) {
  const [label, setLabel] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const lock = useRef(false);
  const set = async (key: string) => {
    if (lock.current) return;
    lock.current = true;
    setSaving(key); setMsg(null);
    try { await api.put('/api/env', { key, value: values[key] ?? '' }); setValues({ ...values, [key]: '' }); setMsg(ok(`${key} saved.`)); onSaved(); }
    catch (e) { setMsg(fail(e)); }
    finally { lock.current = false; setSaving(null); }
  };
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">The Excel's "Login as" column names an account in plain words. Values go to the private .env file and are never shown again, never sent to the AI, and never committed.</p>
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
      <div className="flex flex-wrap gap-2">
        <input className={`${inputCls} max-w-xs`} placeholder="New account, e.g. Manager test account" value={label} disabled={adding} onChange={e => setLabel(e.target.value)} />
        <Button busy={adding} disabled={!label.trim() || !!saving} onClick={async () => {
          if (lock.current) return;
          lock.current = true;
          setAdding(true); setMsg(null);
          try { await api.post('/api/env/accounts', { label }); setLabel(''); setMsg(ok('Account added.')); onSaved(); }
          catch (e) { setMsg(fail(e)); }
          finally { lock.current = false; setAdding(false); }
        }}>{adding ? 'Adding…' : 'Add account'}</Button>
      </div>
      <MsgNotice msg={msg} className="" />
    </div>
  );
}
