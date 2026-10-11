import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Event, type Interaction } from '../api';
import { ApiKeyBox } from '../components/ApiKey';
import { useLive } from '../components/Live';
import { Stepper, type StepDef, type StepState } from '../components/Stepper';
import { Button, Field, Loading, MsgNotice, Notice, Pill, Pre, QueryGate, Table, errorText, fail, inputCls, ok, useTitle, type Msg } from '../ui';

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
      || (e.type === 'note' && /^Login setup (finished|stopped)/.test(e.text ?? ''))) running = false;
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
  const { events } = useLive();

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
      body: <ApiKeyBox settings={settings.data} />,
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
      summary: accounts.length ? accounts.map(accountSummary).join(' · ') : 'The people the Excel names in "Login as".',
      body: env.data ? <Accounts env={env.data} onSaved={() => qc.invalidateQueries({ queryKey: ['env'] })} /> : <Loading />,
    },
    {
      id: 'login', title: 'How the tests log in',
      state: loginTs.isPending ? 'todo' : loginWaiting ? 'waiting' : running ? 'current' : loginWritten ? 'done' : 'current',
      summary: loginWaiting ? 'The login agent asked you something. Answer below.' : running ? 'The login agent is working…'
        : loginWritten ? 'tests/login.ts is written.' : 'The login agent writes tests/login.ts once, by looking at your login page.',
      body: <Login running={running} written={loginWritten} />,
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

function Login({ running, written }: { running: boolean; written: boolean }) {
  const qc = useQueryClient();
  const [job, setJob] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const source = useQuery({ queryKey: ['login-source'], queryFn: () => api.get<{ source: string; excel: string; cases: number; accounts: string[] }>('/api/setup/login-source') });
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
        logs in. From then on every test logs in through that code. The agent never sees a password.
        What it says, and every command it runs, stays in the live panel.</p>
      <div className="grid gap-1.5">
        <div className="text-sm font-medium">Test cases the agent reads</div>
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-2/40 px-3 py-2">
          <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded bg-good/15 text-xs font-semibold text-good">XLS</span>
          <div className="min-w-0 flex-1 text-sm">
            {file ? <>
              <div className="truncate font-medium">{file.name}</div>
              <div className="text-xs text-muted">Chosen now: the agent reads this one when you start it.</div>
            </> : source.isPending ? <div className="text-muted">Finding the Excel in use…</div>
            : source.isError ? <div className="text-bad">Could not tell which Excel is in use ({errorText(source.error)}).</div>
            : source.data?.source ? <>
              <div className="truncate font-medium">{source.data.excel}</div>
              <div className="text-xs text-muted">{source.data.cases} cases · from {source.data.source}
                {source.data.accounts.length ? ` · accounts: ${source.data.accounts.join(', ')}` : ''}</div>
            </> : <>
              <div className="font-medium">No Excel yet</div>
              <div className="text-xs text-muted">Choose the Excel you will test with: it tells the agent which accounts log in and what they see.</div>
            </>}
          </div>
          <input ref={picker} type="file" accept=".xlsx" className="sr-only" tabIndex={-1} aria-hidden
            onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <Button disabled={running || !!job} onClick={() => picker.current?.click()}>
            {file || source.data?.source ? 'Use a different Excel…' : 'Choose Excel…'}</Button>
          {file && <Button kind="ghost" disabled={running || !!job} onClick={() => { setFile(null); if (picker.current) picker.current.value = ''; }}>Undo</Button>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" busy={job === 'setup' || running} disabled={!!job || running}
          onClick={() => go('setup', () => { const form = new FormData(); if (file) form.append('file', file); return api.post('/api/setup/login', form); })}>
          {running ? 'Login agent working…' : job === 'setup' ? 'Starting…' : written ? 'Set up login again' : 'Set up login with AI'}
        </Button>
        {running && <Button kind="danger" busy={job === 'stop'} disabled={job === 'stop'} onClick={() => go('stop', () => api.post('/api/setup/login/stop'))}>
          {job === 'stop' ? 'Stopping…' : 'Stop'}</Button>}
        <Button busy={job === 'check'} disabled={!!job || running} onClick={() => go('check', () => api.post('/api/setup/check-login'))}>
          {job === 'check' ? 'Checking every account…' : 'Check every account logs in'}</Button>
      </div>
      {output && <Pre className="max-h-40 overflow-y-auto">{output}</Pre>}
      {error && <Notice>{error}</Notice>}
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

function accountSummary(a: any) {
  const label = a.label || a.name;
  if (a.user_set && a.password_set) return `${label} · ${a.user}`;
  return `${label} (not saved)`;
}

function usedLine(ids: string[]) {
  if (!ids?.length) return '';
  if (ids.length <= 3) return `Named in ${ids.join(', ')}`;
  return `Named in ${ids.length} test cases`;
}

function Accounts({ env, onSaved }: { env: any; onSaved: () => void }) {
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [adding, setAdding] = useState(false);
  const lock = useRef(false);
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">Each row is a person the tests log in as. The Excel names them in plain words, such as Employee test account. Saving keeps the user on screen. The password stays on this machine and is not shown again.</p>
      {env.accounts.length === 0 && <p className="text-sm text-muted">No people yet. Add one, then enter how they sign in.</p>}
      {env.accounts.map((a: any) => <AccountCard key={a.name} account={a} onSaved={onSaved} />)}
      <form className="flex flex-wrap gap-2" onSubmit={async e => {
        e.preventDefault();
        if (lock.current || !label.trim()) return;
        lock.current = true;
        setAdding(true); setMsg(null);
        try {
          const r = await api.post<{ label: string; created: boolean }>('/api/env/accounts', { label: label.trim() });
          setLabel('');
          setMsg(r.created ? ok(`${r.label} added. Enter their user and password.`) : ok(`${r.label} is already on the list.`));
          onSaved();
        } catch (err) { setMsg(fail(err)); }
        finally { lock.current = false; setAdding(false); }
      }}>
        <input className={`${inputCls} max-w-xs`} placeholder="New person, e.g. Employee test account" aria-label="New person" value={label} disabled={adding} onChange={e => setLabel(e.target.value)} />
        <Button type="submit" busy={adding} disabled={!label.trim()}>{adding ? 'Adding…' : 'Add person'}</Button>
      </form>
      <MsgNotice msg={msg} className="" />
    </div>
  );
}

function AccountCard({ account, onSaved }: { account: any; onSaved: () => void }) {
  const ready = !!(account.user_set && account.password_set);
  const label = account.label || account.name;
  const [editing, setEditing] = useState(false);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [held, setHeld] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const named = usedLine(account.used_by ?? []);
  const showCard = !editing && !cleared && (ready || held !== null);
  const shownUser = ready ? account.user : held;
  const save = async () => {
    setBusy('save'); setMsg(null);
    try {
      await api.put(`/api/env/accounts/${account.name}`, { user: user.trim(), password });
      setHeld(user.trim()); setCleared(false); setPassword(''); setEditing(false);
      setMsg(ok(`${label} saved.`));
      onSaved();
    } catch (e) { setMsg(fail(e)); }
    finally { setBusy(null); }
  };
  if (showCard) {
    return (
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-good/50 bg-good/5 px-3 py-2.5">
          <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-good text-xs text-white">✓</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{label}</div>
            <div className="truncate text-sm text-muted">{shownUser}</div>
            <div className="text-xs text-muted">Password saved{named ? ` · ${named}` : ''}</div>
          </div>
          <Button disabled={!!busy} onClick={() => { setEditing(true); setUser(account.user || ''); setPassword(''); setMsg(null); }}>Change</Button>
          <Button kind="danger" busy={busy === 'clear'} disabled={!!busy} onClick={async () => {
            setBusy('clear'); setMsg(null);
            try {
              await api.del(`/api/env/accounts/${account.name}`);
              setUser(''); setPassword(''); setHeld(null); setCleared(true);
              setMsg(ok(`${label} removed. The name stays, so you can save them again.`));
              onSaved();
            } catch (e) { setMsg(fail(e)); }
            finally { setBusy(null); }
          }}>{busy === 'clear' ? 'Removing…' : 'Remove'}</Button>
        </div>
        <MsgNotice msg={msg} className="" />
      </div>
    );
  }
  return (
    <form className="grid gap-3 rounded-md border border-line px-3 py-3" onSubmit={e => { e.preventDefault(); if (user.trim() && !busy) save(); }}>
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs text-muted">{editing
          ? 'A blank password keeps the one already saved.'
          : 'Not saved yet. Tests cannot log in as this person until you save a user and a password.'}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="User">
          <input className={inputCls} autoComplete="off" value={user} disabled={!!busy} placeholder="name@company.test" onChange={e => setUser(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" className={inputCls} autoComplete="new-password" value={password} disabled={!!busy}
            placeholder={account.password_set ? 'Saved — type to replace' : 'Password'} onChange={e => setPassword(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" kind="primary" busy={busy === 'save'} disabled={!user.trim() || !!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
        {editing && <Button disabled={!!busy} onClick={() => { setEditing(false); setUser(''); setPassword(''); setMsg(null); }}>Cancel</Button>}
      </div>
      <MsgNotice msg={msg} className="" />
    </form>
  );
}
