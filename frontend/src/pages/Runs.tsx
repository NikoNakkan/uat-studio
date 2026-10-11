import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useLoginWritten, useRuns, useSettings } from '../lib/queries';
import { api, type RunSummary } from '../api';
import { ExcelPicker, useLatestExcel } from '../components/ExcelPicker';
import { RunActions } from '../components/RunActions';
import { Stepper, type StepDef } from '../components/Stepper';
import { Button, Empty, Field, Notice, Pill, QueryGate, Table, errorText, inputCls, useTitle } from '../ui';

const STRICTNESS = {
  basic: 'Only what makes a test impossible to run',
  standard: 'Also vague words, unclear names, glossary conflicts (default)',
  strict: 'Also exact values everywhere, and confirm every delete, send or pay step',
};

export function RunsPage() {
  useTitle('Test runs');
  const runs = useRuns();
  const settings = useSettings();
  const login = useLoginWritten();
  const ready = !!settings.data?.api_key_set && login.written;
  const list = runs.data ?? [];
  const latest = list[0];

  const steps: StepDef[] = [
    {
      id: 'setup', title: 'Set up', state: settings.isPending || login.pending ? 'todo' : ready ? 'done' : 'current',
      summary: ready ? 'API key, machine, accounts and login are ready.' : 'Once per machine and app: API key, test accounts and login.',
      body: <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted">{ready ? 'Everything is set up. Open it again to change accounts or login.' : 'A few steps, each opens when it is its turn.'}</p>
        <Link to="/setup" className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-ink">{ready ? 'Review set up' : 'Set up now →'}</Link>
      </div>,
    },
    {
      id: 'new', title: 'Upload your Excel', state: ready ? (latest ? 'done' : 'current') : 'todo',
      summary: latest ? `Last: ${latest.excel}` : 'One row per test case, in the agreed template. The run starts right away.',
      body: <NewRun />,
    },
    {
      id: 'runs', title: 'Follow the run and sign off',
      state: !latest ? 'todo' : latest.waiting > 0 ? 'waiting' : latest.running ? 'current' : latest.sealed ? 'done' : 'current',
      summary: !latest ? 'Each run walks its stages; it stops only when it needs you.'
        : `${latest.id}: ${latest.stages_done}/${latest.stages_total} stages${latest.waiting ? ' · waiting for you' : latest.running ? ' · running' : latest.sealed ? ' · signed off' : ''}`,
      body: <AllRuns runs={runs} />,
    },
  ];

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <div>
        <h1 className="text-xl font-semibold">Test runs</h1>
        <p className="text-sm text-muted">An Excel of test cases goes in; tested evidence and a signed-off results.xlsx come out.</p>
      </div>
      <Stepper label="From Excel to sign-off" steps={steps} />
    </div>
  );
}

function NewRun() {
  const examples = useQuery({ queryKey: ['examples'], queryFn: () => api.get<string[]>('/api/kit/examples') });
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const latest = useLatestExcel();
  const canReuse = !!latest.data?.reusable;
  const [strictness, setStrictness] = useState<keyof typeof STRICTNESS>('standard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const start = async () => {
    if ((!file && !canReuse) || lock.current) return;
    lock.current = true;
    setBusy(true); setError('');
    try {
      const form = new FormData();
      if (file) form.append('file', file); else form.append('reuse', 'latest');
      form.append('strictness', strictness);
      form.append('start', 'true');
      const r = await api.post<{ id: string; started: boolean; message?: string }>('/api/runs', form);
      if (!r.started && r.message) setError(r.message);
      navigate(`/runs/${r.id}`);
    } catch (e) { setError(errorText(e)); } finally { lock.current = false; setBusy(false); }
  };
  return (
    <div className="grid gap-4">
      <form className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] md:items-end" onSubmit={e => { e.preventDefault(); start(); }}>
        <ExcelPicker label="Excel of test cases" file={file} onFile={setFile} disabled={busy}
          emptyHint="One row per test case, in the agreed template." />
        <Field label="How many questions?" hint={STRICTNESS[strictness]}>
          <select className={inputCls} value={strictness} disabled={busy} onChange={e => setStrictness(e.target.value as keyof typeof STRICTNESS)}>
            {Object.keys(STRICTNESS).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Button type="submit" kind="primary" busy={busy} disabled={!file && !canReuse}>{busy ? 'Starting…' : 'Start run'}</Button>
      </form>
      {error && <Notice>{error}</Notice>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <a className="text-accent hover:underline" href="/api/kit/template">Download the Excel template</a>
        <QueryGate pending={examples.isPending} error={examples.isError ? examples.error : null} label="Loading examples…">
          {examples.data?.map(x => <a key={x} className="text-accent hover:underline" href={`/api/kit/examples/${x}`}>Example: {x}</a>)}
        </QueryGate>
      </div>
    </div>
  );
}

function AllRuns({ runs }: { runs: { isPending: boolean; isError: boolean; error: unknown; data?: RunSummary[] } }) {
  return (
    <QueryGate pending={runs.isPending} error={runs.isError ? runs.error : null} label="Loading runs…">
      {runs.data?.length ? (
        <Table head={['Run', 'Excel', 'Stages', 'Tests passed', 'State', '']} rows={runs.data.map(r => [
          <Link className="font-mono text-accent hover:underline" to={`/runs/${r.id}`}>{r.id}</Link>,
          r.excel,
          <span className="tnum">{r.stages_done}/{r.stages_total}{r.current ? <span className="text-muted"> · {r.current}</span> : null}</span>,
          <span className="tnum">{r.passed}/{r.tests}</span>,
          <div className="flex flex-wrap items-center gap-1">
            {r.running && <Pill value="running" />}
            {r.waiting > 0 && <Link to={`/runs/${r.id}`}><Pill value="waiting" label={`${r.waiting} waiting for you`} /></Link>}
            {r.sealed && <Pill value="done" label="signed off" />}
            {r.results && <a className="text-xs text-accent hover:underline" href={`/api/runs/${r.id}/results.xlsx`}>results.xlsx</a>}
          </div>,
          <RunActions runId={r.id} running={r.running} sealed={r.sealed} size="small" />,
        ])} />
      ) : <Empty>No runs yet. Upload an Excel in the step above.</Empty>}
    </QueryGate>
  );
}
