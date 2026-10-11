import { Link } from 'react-router';
import type { RunSummary } from '../../api';
import { usd } from '../../lib/money';
import { STAGES } from '../run/stages';
import { RunActions } from '../RunActions';
import { stateOf, when } from './runState';

/**
 * One run in a list: when it ran and with which Excel, where it stands, how far it got and how its tests did,
 * and what can be done with it. `big` is the dashboard's latest run.
 */
export function RunCard({ run: r, big = false }: { run: RunSummary; big?: boolean }) {
  const state = stateOf(r.state);
  const stage = r.current ? STAGES[r.current]?.title ?? r.current : null;
  const notRun = Math.max(0, r.tests - r.passed - r.failed);
  return (
    <article className={`relative overflow-hidden rounded-lg border border-line bg-surface ${big ? 'p-5' : 'p-4'}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${state.bar}`} />
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/runs/${r.id}`} className={`font-semibold hover:underline ${big ? 'text-lg' : ''}`}>{when(r.created, r.id)}</Link>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${state.badge}`}>
              {state.label}{r.waiting > 1 ? ` (${r.waiting})` : ''}</span>
            <span className="font-mono text-xs text-muted">{r.id}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span aria-hidden className="rounded bg-good/15 px-1 text-[10px] font-semibold text-good">XLS</span>
            <span className="font-medium text-ink">{r.excel ?? 'Excel not recorded'}</span>
            {r.cases > 0 && <span>· {r.cases} cases</span>}
            {r.strictness && <span>· {r.strictness} questions</span>}
            {r.cost > 0 && <span title="What the agents of this run cost">· <b className="font-medium text-ink tnum">{usd(r.cost)}</b> in AI</span>}
          </div>
        </div>
        <Results passed={r.passed} failed={r.failed} notRun={notRun} />
      </div>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>{stage && r.state !== 'signed_off' ? `${r.state === 'stopped' ? 'Stopped at' : 'Now'}: ${stage}` : 'All stages'}</span>
          <span className="tnum">{r.stages_done} of {r.stages_total} stages</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={r.stages_total} aria-valuenow={r.stages_done}>
          <div className={`h-full ${state.bar}`} style={{ width: `${(r.stages_done / Math.max(1, r.stages_total)) * 100}%` }} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <Link to={`/runs/${r.id}`} className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-ink hover:brightness-95">
          {r.state === 'waiting' ? 'Answer' : r.state === 'finished' ? 'Sign off' : 'Open'}</Link>
        {r.results && <a href={`/api/runs/${r.id}/results.xlsx`} className="rounded-md border border-line px-3 py-1.5 font-medium hover:bg-surface-2">results.xlsx</a>}
        {r.cases > 0 && <a href={`/api/runs/${r.id}/clarified.xlsx`} className="rounded-md px-2 py-1.5 text-link hover:underline">Clarified Excel</a>}
        <span className="ml-auto"><RunActions runId={r.id} running={r.running} sealed={r.sealed} size="small" /></span>
      </div>
    </article>
  );
}

function Results({ passed, failed, notRun }: { passed: number; failed: number; notRun: number }) {
  const total = passed + failed + notRun;
  if (!total) return <div className="text-sm text-muted">No tests run yet</div>;
  return (
    <div className="min-w-44">
      <div className="flex gap-3 text-sm tnum">
        <span><b className="text-good">{passed}</b> passed</span>
        {failed > 0 && <span><b className="text-bad">{failed}</b> failed</span>}
        {notRun > 0 && <span className="text-muted">{notRun} not run</span>}
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="bg-good" style={{ width: `${(passed / total) * 100}%` }} />
        <div className="bg-bad" style={{ width: `${(failed / total) * 100}%` }} />
      </div>
    </div>
  );
}
