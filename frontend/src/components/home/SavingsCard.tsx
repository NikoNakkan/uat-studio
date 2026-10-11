import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Project, type RunSummary, type Savings } from '../../api';
import { COST_NOTE, usd } from '../../lib/money';
import { runSavings } from '../../lib/savings';
import { useAction } from '../../lib/useAction';
import { Button, Card, Empty, Field, Notice, inputCls } from '../../ui';
import { when } from '../runs/runState';

/** What the runs saved against a person testing this app by hand, from a rate and hours the person sets. */
export function SavingsCard({ project, runs }: { project: Project; runs: RunSummary[] }) {
  const s = runSavings(runs, project.savings);
  const total = s.total != null && s.rows.length > 0
    ? <span className="text-2xl font-semibold tnum text-good" title={COST_NOTE}>{usd(s.total)}</span> : undefined;
  return (
    <Card title="Costs saved" actions={total}>
      <SavingsForm key={project.id} project={project} />
      {s.byHand == null
        ? <p className="mt-4 text-sm text-muted">Enter what a person costs per hour to see what each run saved.</p>
        : s.rows.length === 0
          ? <div className="mt-4"><Empty>No run has tested the app yet.</Empty></div>
          : <>
            <p className="mt-4 text-sm text-muted">
              {s.rows.length} run{s.rows.length === 1 ? '' : 's'} that tested the app: about <b className="tnum text-ink">{s.hours}</b> hours
              of testing by hand, at ${s.byHand.toLocaleString()} a run.
            </p>
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="py-1 font-medium">Run</th><th className="font-medium">By hand</th><th className="font-medium">AI</th><th className="text-right font-medium">Saved</th></tr>
              </thead>
              <tbody className="tnum divide-y divide-line">
                {s.rows.map(r => (
                  <tr key={r.id}>
                    <td className="py-1.5">{when(r.created, r.id)}</td>
                    <td>${s.byHand?.toLocaleString()}</td>
                    <td>{usd(r.ai)}</td>
                    <td className={`text-right font-medium ${(r.saved ?? 0) >= 0 ? 'text-good' : 'text-bad'}`}>{usd(r.saved)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">The AI cost is an estimate. Not counted: the time you spend answering questions and signing off.</p>
          </>}
    </Card>
  );
}

const text = (n: number | null) => n?.toString() ?? '';

/** The rate and hours, kept as a draft until saved, so typing never jumps. */
function SavingsForm({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [rate, setRate] = useState(text(project.savings.hourly_rate));
  const [hours, setHours] = useState(text(project.savings.manual_hours));
  const { busy, error, run } = useAction();
  const unchanged = text(project.savings.hourly_rate) === rate && text(project.savings.manual_hours) === hours;
  const save = () => run('save', async () => {
    const body: Savings = { hourly_rate: rate.trim() === '' ? null : Number(rate), manual_hours: Number(hours) };
    await api.put(`/api/projects/${project.id}/savings`, body);
    await qc.invalidateQueries({ queryKey: ['projects'] });
  });
  return (
    <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={e => { e.preventDefault(); save(); }}>
      <Field label="A person costs, per hour (USD)">
        <input className={inputCls} type="number" min={0} step="any" inputMode="decimal" placeholder="e.g. 40"
          value={rate} onChange={e => setRate(e.target.value)} />
      </Field>
      <Field label="Testing this app by hand takes (hours)">
        <input className={inputCls} type="number" min={0.25} step="any" inputMode="decimal" required
          value={hours} onChange={e => setHours(e.target.value)} />
      </Field>
      <Button type="submit" busy={busy === 'save'} disabled={!!busy || unchanged}>{busy === 'save' ? 'Saving…' : unchanged && project.savings.hourly_rate != null ? 'Saved' : 'Save'}</Button>
      {error && <div className="sm:col-span-3"><Notice>{error}</Notice></div>}
    </form>
  );
}
