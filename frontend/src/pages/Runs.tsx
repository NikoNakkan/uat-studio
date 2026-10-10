import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, type RunSummary } from '../api';
import { Button, Card, Empty, Field, Pill, Table, errorText, inputCls } from '../ui';

const STRICTNESS = {
  basic: 'Only what makes a test impossible to run',
  standard: 'Also vague words, unclear names, glossary conflicts (default)',
  strict: 'Also exact values everywhere, and confirm every delete, send or pay step',
};

export function RunsPage() {
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => api.get<RunSummary[]>('/api/runs'), refetchInterval: 4000 });
  const examples = useQuery({ queryKey: ['examples'], queryFn: () => api.get<string[]>('/api/kit/examples') });
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [strictness, setStrictness] = useState<keyof typeof STRICTNESS>('standard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('strictness', strictness);
      form.append('start', 'true');
      const r = await api.post<{ id: string; started: boolean; message?: string }>('/api/runs', form);
      if (!r.started && r.message) setError(r.message);
      navigate(`/runs/${r.id}`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <div>
        <h1 className="text-xl font-semibold">Runs</h1>
        <p className="text-sm text-muted">Each run takes one Excel of test cases through clarification, Playwright, evidence and sign-off.</p>
      </div>
      <Card title="New run">
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <Field label="Excel file" hint="One row per test case, in the agreed template.">
            <input type="file" accept=".xlsx" className={inputCls} onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Clarification strictness" hint={STRICTNESS[strictness]}>
            <select className={inputCls} value={strictness} onChange={e => setStrictness(e.target.value as keyof typeof STRICTNESS)}>
              {Object.keys(STRICTNESS).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Button kind="primary" disabled={!file || busy} onClick={start}>{busy ? 'Starting…' : 'Start run'}</Button>
        </div>
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a className="text-accent hover:underline" href="/api/kit/template">Download the Excel template</a>
          {examples.data?.map(x => <a key={x} className="text-accent hover:underline" href={`/api/kit/examples/${x}`}>Example: {x}</a>)}
        </div>
      </Card>
      <Card title="All runs">
        {runs.data?.length ? (
          <Table head={['Run', 'Excel', 'Strictness', 'Stages', 'Tests passed', 'State']} rows={runs.data.map(r => [
            <Link className="font-mono text-accent hover:underline" to={`/runs/${r.id}`}>{r.id}</Link>,
            r.excel, r.strictness,
            <span className="tnum">{r.stages_done}/{r.stages_total}{r.current ? <span className="text-muted"> · {r.current}</span> : null}</span>,
            <span className="tnum">{r.passed}/{r.tests}</span>,
            <div className="flex flex-wrap gap-1">
              {r.running && <Pill value="running" />}
              {r.waiting > 0 && <Pill value="waiting" label={`${r.waiting} waiting for you`} />}
              {r.sealed && <Pill value="done" label="signed off" />}
              {r.results && <a className="text-xs text-accent hover:underline" href={`/api/runs/${r.id}/results.xlsx`}>results.xlsx</a>}
            </div>,
          ])} />
        ) : <Empty>No runs yet. Upload an Excel above to start the first one.</Empty>}
      </Card>
    </div>
  );
}
