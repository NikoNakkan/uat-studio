import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, type RunDetail } from '../api';
import { RunActions } from '../components/RunActions';
import { Stepper, type StepDef } from '../components/Stepper';
import { FilesView, UsageView } from '../components/run/RunDetails';
import { stageOutput } from '../components/run/StageOutput';
import { STAGES, stageMeta, stageState } from '../components/run/stages';
import { useRun } from '../lib/queries';
import { useAction } from '../lib/useAction';
import { Button, Loading, Notice, errorText, useTitle } from '../ui';

/** One run: its stages as a stepper, each showing what it produced; questions and activity are in the live panel. */
export function RunPage() {
  const { runId = '' } = useParams();
  const run = useRun(runId);
  const [visualFocus, setVisualFocus] = useState<string | null>(null);
  const r = run.data;
  useTitle(r?.id ?? 'Run');
  if (run.isError) return <Notice>{errorText(run.error)}</Notice>;
  if (!r) return <Loading label="Loading this run…" />;

  // Questions carry no stage; they belong to the stage that is running (stages run one after another).
  const activeId = r.stages.find(s => s.status === 'running' || s.status === 'waiting_for_person')?.id;
  const steps: StepDef[] = r.stages.map(s => {
    const state = stageState(s, s.id === activeId && r.pending.length > 0);
    const out = stageOutput(s.id, runId, r, { focus: visualFocus, setFocus: setVisualFocus });
    return {
      id: s.id, title: stageMeta(s).title, state,
      summary: state === 'waiting' ? 'Waiting for you. Answer in the live panel.' : s.note || stageMeta(s).about,
      body: out ?? <p className="text-sm text-muted">The agent and its commands are in the live panel.</p>,
    };
  });

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <RunHeader runId={runId} r={r} />
      <Stepper label="Stages of this run" steps={steps} />
      <details className="rounded-lg border border-line bg-surface p-3 text-sm">
        <summary className="cursor-pointer font-medium">More: model usage and every file of this run</summary>
        <div className="mt-3 grid gap-4"><UsageView d={r.data} /><FilesView runId={runId} /></div>
      </details>
    </div>
  );
}

/** The run's name and Excel, and what can be done with it: start or resume, retry a stage, stop, delete, download. */
function RunHeader({ runId, r }: { runId: string; r: RunDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const act = (name: string, fn: () => Promise<unknown>) => run(name, async () => { await fn(); qc.invalidateQueries({ queryKey: ['run', runId] }); });
  const prog = r.data.progress ?? {};
  const failedStage = r.stages.find(s => s.status === 'failed' || s.status === 'waiting_for_person');
  const started = Object.keys(prog.stages ?? {}).length > 0;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/runs" className="text-sm text-link hover:underline">← Test runs</Link>
          <h1 className="font-mono text-lg font-semibold">{r.id}</h1>
          <p className="text-sm text-muted">{prog.excel} · strictness {prog.strictness}{prog.excel_sha256 ? ` · SHA-256 ${prog.excel_sha256.slice(0, 12)}…` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!r.running && <Button kind="primary" busy={busy === 'start'} disabled={!!busy} onClick={() => act('start', () => api.post(`/api/runs/${runId}/start`))}>
            {busy === 'start' ? 'Starting…' : started ? 'Resume' : 'Start'}</Button>}
          <RunActions runId={runId} running={r.running} sealed={!!r.data.manifest} onDeleted={() => navigate('/runs')} />
          {!r.running && failedStage && <Button busy={busy === 'retry'} disabled={!!busy} onClick={() => act('retry', () => api.post(`/api/runs/${runId}/retry`, { stage: failedStage.id }))}>
            {busy === 'retry' ? 'Retrying…' : `Retry "${STAGES[failedStage.id]?.title ?? failedStage.id}"`}</Button>}
          {r.data.cases && <a className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2" href={`/api/runs/${runId}/clarified.xlsx`}
            title="The cases as clarified, in the template: paste them back into your Excel">Clarified Excel</a>}
          {r.results_ready && <a className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:brightness-95" href={`/api/runs/${runId}/results.xlsx`}>Download results.xlsx</a>}
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
    </>
  );
}
