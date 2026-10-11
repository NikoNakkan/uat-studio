import { useQueryClient } from '@tanstack/react-query';
import { api, type RunSummary } from '../../api';
import { useProjects } from '../../lib/queries';
import { useAction } from '../../lib/useAction';

const WHY = 'New runs compare their step screenshots with this run.';

/** Marks the run new runs compare their screenshots with: chosen by the person, or the latest automatically. */
export function BaselineBadge({ run }: { run: RunSummary }) {
  if (!run.baseline) return null;
  return (
    <span title={run.baseline === 'latest' ? `${WHY} It is the latest run with screenshots; choose another on any run.` : `${WHY} You chose it.`}
      className="rounded-full border border-accent/70 px-2 py-0.5 text-xs font-medium">
      Baseline{run.baseline === 'latest' ? ' · latest' : ''}</span>
  );
}

/** Choose this run as the baseline, or go back to the latest run when this one was chosen. */
export function BaselineButton({ run }: { run: RunSummary }) {
  const qc = useQueryClient();
  const project = useProjects().data?.projects.find(p => p.current);
  const { busy, error, run: act } = useAction();
  if (!project || run.running || run.baseline === 'latest' || (!run.baseline && !run.screens)) return null;
  const choose = (runId: string | null) => act('baseline', async () => {
    await api.put(`/api/projects/${project.id}/baseline`, { run_id: runId });
    await qc.invalidateQueries({ queryKey: ['runs'] });
    await qc.invalidateQueries({ queryKey: ['projects'] });
  });
  return (
    <>
      <button type="button" disabled={!!busy} onClick={() => choose(run.baseline === 'chosen' ? null : run.id)}
        title={run.baseline === 'chosen' ? 'Compare new runs with the latest run that has screenshots' : WHY}
        className="rounded-md px-2 py-1.5 text-link hover:underline disabled:opacity-60">
        {busy ? 'Saving…' : run.baseline === 'chosen' ? 'Use the latest instead' : 'Use as baseline'}</button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </>
  );
}
