import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, runFile, type RunDetail } from '../../api';
import type { RunData } from '../../types/run';
import { Card, Empty, Pre, QueryGate, Table } from '../../ui';

/** Each failure's diagnosis: bug, broken test or environment, how it was reproduced, and the repair decision. */
export function FailuresView({ r }: { r: RunDetail }) {
  const diag = r.data.diagnoses ?? {};
  return (
    <div className="grid gap-4">
      <Card title="Diagnoses">
        {Object.keys(diag).length ? <Table head={['Test', 'Cause', 'Reproduction', 'Repair', 'Summary']} rows={Object.entries(diag).map(([id, x]) => [
          <span className="font-mono">{id}</span>, x.cause ?? '—',
          x.reproduction ? `${x.reproduction}${x.reproduction_detail ? ` (${x.reproduction_detail})` : ''}` : '—',
          x.repair ?? '—', x.summary ?? x.error,
        ])} /> : <Empty>No failures diagnosed.</Empty>}
      </Card>
      {r.texts['diagnoses.md'] && <Card title="diagnoses.md"><Pre>{r.texts['diagnoses.md']}</Pre></Card>}
    </div>
  );
}

/** Tokens per stage and agent, with a total per model. */
export function UsageView({ d }: { d: RunData }) {
  const rows = useMemo(() => d.usage ?? [], [d.usage]);
  const totals = useMemo(() => {
    const t: Record<string, { input: number; output: number }> = {};
    for (const u of rows) {
      t[u.model] ??= { input: 0, output: 0 };
      t[u.model].input += u.input_tokens;
      t[u.model].output += u.output_tokens;
    }
    return t;
  }, [rows]);
  if (!rows.length) return <Empty>No AI work recorded for this run yet.</Empty>;
  const n = (v: number) => <span className="tnum">{v.toLocaleString()}</span>;
  return (
    <Card title="Model and tokens per stage">
      <Table head={['Stage', 'Agent', 'Model', 'Input tokens', 'Output tokens', 'Source']} rows={[
        ...rows.map(u => [u.stage, u.agent, u.model, n(u.input_tokens), n(u.output_tokens), u.source]),
        ...Object.entries(totals).map(([m, t]) => [<b>Total</b>, '', m, <b>{n(t.input)}</b>, <b>{n(t.output)}</b>, '']),
      ]} />
    </Card>
  );
}

/** Every file of the run, each opening in a new tab. */
export function FilesView({ runId }: { runId: string }) {
  const files = useQuery({ queryKey: ['allfiles', runId], queryFn: () => api.get<string[]>(`/api/runs/${runId}/files`) });
  return (
    <Card title="Every file of this run">
      <QueryGate pending={files.isPending} error={files.isError ? files.error : null} label="Loading files…">
        {files.data?.length
          ? <ul className="grid gap-0.5 font-mono text-xs">{files.data.map(f => <li key={f}><a className="text-accent hover:underline" href={runFile(runId, f)} target="_blank" rel="noreferrer">{f}</a></li>)}</ul>
          : <Empty>This run has no files yet.</Empty>}
      </QueryGate>
    </Card>
  );
}
