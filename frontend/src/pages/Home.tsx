import { Link } from 'react-router';
import { SavingsCard } from '../components/home/SavingsCard';
import { RunCard } from '../components/runs/RunCard';
import { stateOf, when } from '../components/runs/runState';
import { useEnv, useInteractions, useLoginWritten, useProjects, useRuns, useSettings, useSetupCheck } from '../lib/queries';
import { COST_NOTE, usd } from '../lib/money';
import { Card, Empty, QueryGate, useTitle } from '../ui';

/** The project's home: is it ready, what happened last, what needs the person, and a way to start a run. */
export function HomePage() {
  const projects = useProjects();
  const project = projects.data?.projects.find(p => p.current);
  const name = project?.name ?? 'This project';
  useTitle(name);
  const env = useEnv();
  const runs = useRuns();
  const open = useInteractions();
  const list = runs.data ?? [];
  const latest = list[0];
  const waiting = (open.data ?? []).length;

  return (
    <div className="mx-auto grid max-w-5xl gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{name}</h1>
          {env.data?.start_page && <a href={env.data.start_page} target="_blank" rel="noreferrer" className="font-mono text-sm text-link hover:underline">{env.data.start_page}</a>}
        </div>
        <Link to="/runs?new=1" className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink hover:brightness-95">New run</Link>
      </div>

      <SetupStatus />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Runs" value={list.length} />
        <Tile label="Last run" value={latest ? `${latest.passed}/${latest.tests}` : '—'} note={latest ? 'tests passed' : 'no run yet'} />
        <Tile label="Waiting for you" value={waiting} tone={waiting ? 'warn' : undefined} to={waiting && latest ? `/runs/${latest.id}` : undefined} />
        <Tile label="Signed off" value={list.filter(r => r.sealed).length} />
        <Tile label="Spent on AI (est.)" title={COST_NOTE} value={usd(list.reduce((sum, r) => sum + (r.cost ?? 0), 0))} note={latest ? `last run ${usd(latest.cost)}` : undefined} />
      </div>

      <QueryGate pending={runs.isPending} error={runs.isError ? runs.error : null} label="Loading runs…">
        {latest ? (
          <section className="grid gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Latest run</h2>
            <RunCard run={latest} big />
          </section>
        ) : <Empty>No runs yet. Upload your Excel of test cases with New run.</Empty>}
        {list.length > 1 && (
          <Card title="Earlier runs" actions={<Link to="/runs" className="text-sm text-link hover:underline">All runs →</Link>}>
            <ul className="divide-y divide-line">
              {list.slice(1, 6).map(r => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <Link to={`/runs/${r.id}`} className="font-medium hover:underline">{when(r.created, r.id)}</Link>
                  <span className="text-muted">{r.excel}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${stateOf(r.state).badge}`}>{stateOf(r.state).label}</span>
                  <span className="tnum text-muted">{r.passed}/{r.tests} passed</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {project && <SavingsCard project={project} runs={list} />}
      </QueryGate>
    </div>
  );
}

/** One line when set up is complete; a clear call to finish it when it is not. */
function SetupStatus() {
  const settings = useSettings();
  const check = useSetupCheck();
  const env = useEnv();
  const login = useLoginWritten();
  const accounts = env.data?.accounts ?? [];
  const items = [
    { ok: !!settings.data?.api_key_set, label: 'API key' },
    { ok: !!check.data?.rows.every(r => r.status === 'OK' || r.status === 'INFO'), label: 'this machine' },
    { ok: accounts.length > 0 && accounts.every(a => a.user_set && a.password_set), label: `${accounts.length} test account${accounts.length === 1 ? '' : 's'}` },
    { ok: login.written, label: 'login' },
  ];
  if (settings.isPending || check.isPending || env.isPending || login.pending) return null;
  const missing = items.filter(i => !i.ok);
  if (!missing.length) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-good text-[11px] text-white" aria-hidden>✓</span>
        Set up: {items.map(i => i.label).join(' · ')}
        <Link to="/setup" className="text-link hover:underline">Review</Link>
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-warn/60 bg-warn/5 p-4">
      <div>
        <div className="font-semibold">Set up is not finished</div>
        <div className="text-sm text-muted">Still needed: {missing.map(i => i.label).join(', ')}. Runs cannot start until it is.</div>
      </div>
      <Link to="/setup" className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-ink">Finish set up →</Link>
    </div>
  );
}

function Tile({ label, value, note, tone, to, title }: { label: string; value: number | string; note?: string; tone?: 'warn'; to?: string; title?: string }) {
  const body = (
    <div title={title} className={`h-full rounded-lg border bg-surface p-4 ${tone === 'warn' ? 'border-warn/60' : 'border-line'} ${to ? 'hover:border-accent' : ''}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tnum ${tone === 'warn' ? 'text-warn' : ''}`}>{value}</div>
      {note && <div className="text-xs text-muted">{note}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}
