import { useMemo } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AiProviderCard } from '../components/AiProvider';
import { useLive } from '../components/Live';
import { Stepper, type StepDef, type StepState } from '../components/Stepper';
import { Accounts, accountSummary } from '../components/setup/Accounts';
import { AppUnderTest } from '../components/setup/AppUnderTest';
import { Login, loginRunning } from '../components/setup/Login';
import { Machine } from '../components/setup/Machine';
import { useEnv, useInteractions, useLoginWritten, useSettings, useSetupCheck } from '../lib/queries';
import { Loading, Notice, errorText, useTitle } from '../ui';

const stateOf = (done: boolean, pending: boolean): StepState => (pending ? 'todo' : done ? 'done' : 'current');

/** Once per machine and app: API key, this machine, the app under test, its accounts and how tests log in. */
export function SetupPage() {
  useTitle('Setup');
  const qc = useQueryClient();
  const settings = useSettings();
  const check = useSetupCheck();
  const env = useEnv();
  const login = useLoginWritten();
  const open = useInteractions();
  const { events } = useLive();
  const running = useMemo(() => loginRunning(events), [events]);

  const machineOk = !!check.data && check.data.rows.every(r => r.status === 'OK' || r.status === 'INFO');
  const accounts = env.data?.accounts ?? [];
  const accountsOk = accounts.length > 0 && accounts.every(a => a.user_set && a.password_set);
  const loginWaiting = (open.data ?? []).some(i => i.channel === 'app');
  const envSaved = () => { qc.invalidateQueries({ queryKey: ['env'] }); check.refetch(); };

  const steps: StepDef[] = [
    {
      id: 'key', title: 'Who runs the AI', state: stateOf(!!settings.data?.ai_ready, settings.isPending),
      summary: settings.data?.provider === 'copilot' ? 'GitHub Copilot, with your Copilot plan.'
        : settings.data?.api_key_set ? `Anthropic API key saved (ends ${settings.data.api_key_hint})` : 'An Anthropic API key or a GitHub Copilot plan.',
      body: settings.data ? <AiProviderCard settings={settings.data} /> : null,
    },
    {
      // Where the tests start, then this machine (its check needs the start page): one step.
      id: 'app', title: 'App under test', state: stateOf(!!env.data?.start_page && machineOk, env.isPending || check.isPending),
      summary: [env.data?.start_page || 'Where the tests start, and the only sites the browser may open',
                check.isPending ? 'checking this machine…' : machineOk ? 'this machine is ready' : 'this machine needs fixing'].join(' · '),
      body: env.isError ? <Notice>{errorText(env.error)}</Notice> : env.data ? (
        <div className="grid gap-5">
          <section className="grid gap-2">
            <h3 className="font-semibold">Where the tests start</h3>
            <AppUnderTest env={env.data} onSaved={envSaved} />
          </section>
          <section className="grid gap-2 border-t border-line pt-4">
            <h3 className="font-semibold">This machine</h3>
            <Machine check={check} />
          </section>
        </div>
      ) : <Loading />,
    },
    {
      // How the tests log in, then the accounts it logs in as: one step.
      id: 'accounts', title: 'Test accounts',
      state: env.isPending || login.pending ? 'todo' : loginWaiting ? 'waiting' : running ? 'current'
        : accountsOk && login.written ? 'done' : 'current',
      summary: loginWaiting ? 'The login agent asked you something. Answer below.' : running ? 'The login agent is working…'
        : [accounts.length ? accounts.map(accountSummary).join(' · ') : 'The people the Excel names in "Login as"',
           login.written ? 'login written' : 'login not written yet'].join(' · '),
      body: env.data ? (
        <div className="grid gap-5">
          <section className="grid gap-2">
            <h3 className="font-semibold">How the tests log in</h3>
            <p className="text-sm text-muted">{login.written ? 'tests/login.ts is written.' : 'The login agent writes tests/login.ts once, by looking at your login page, then proves each account below logs in.'}</p>
            <Login running={running} written={login.written} />
          </section>
          <section className="grid gap-2 border-t border-line pt-4">
            <h3 className="font-semibold">The accounts</h3>
            <Accounts env={env.data} onSaved={envSaved} />
          </section>
        </div>
      ) : <Loading />,
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
        <Link to="/runs" className={`rounded-md px-3 py-1.5 text-sm font-semibold ${allDone ? 'bg-accent text-accent-ink hover:brightness-95' : 'border border-line bg-surface text-muted'}`}>Go to test runs →</Link>
      </div>
    </div>
  );
}
