import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, kitFile } from '../api';
import { Card, Empty, Loading, Notice, Pill, Shot as Screenshot, errorText } from '../ui';

type StepShot = {
  name: string; test_id: string; step: number; status: 'changed' | 'unchanged' | 'new'; old: string; new: string;
  diff?: string; changed_pixels?: number; note?: string; step_text: string; expected: string[];
  ai: { label: 'explained' | 'unexplained'; note: string } | null;
};
type TestShots = { test_id: string; title: string; group: string; result: string; recommendation: string;
  counts: Record<string, number>; steps: StepShot[] };
type Visual = { baseline_run: string | null; ai_review: string; skipped?: string; compared: number; tests: TestShots[] };
type Mode = 'side' | 'diff';

/** Decision 26/27: each test's step screenshots next to the last signed-off run, with the AI reviewer's comments. */
export function VisualRegression({ runId, focus }: { runId: string; focus?: string | null }) {
  const q = useQuery({ queryKey: ['visual', runId], queryFn: () => api.get<Visual>(`/api/runs/${runId}/visual`) });
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [mode, setMode] = useState<Mode>('side');
  const tests = useMemo(() => {
    const all = q.data?.tests ?? [];
    const picked = focus ? all.filter(t => t.test_id === focus) : all;
    return onlyChanged ? picked.filter(t => t.counts.changed > 0) : picked;
  }, [q.data, onlyChanged, focus]);

  if (q.isPending) return <Loading label="Loading visual regression…" />;
  if (q.isError) return <Notice>{errorText(q.error)}</Notice>;
  if (!q.data) return <Loading label="Loading visual regression…" />;
  const v = q.data;
  if (!v.tests.length) return <Empty>Screens are compared after the run, in the screens stage.</Empty>;
  const changed = v.tests.reduce((n, t) => n + t.counts.changed, 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {v.baseline_run
            ? <>Compared with the last signed-off run <span className="font-mono">{v.baseline_run}</span>: <b className="tnum">{changed}</b> changed screen(s) in {v.tests.filter(t => t.counts.changed).length} test(s). AI review: {v.ai_review}.</>
            : <>No signed-off run yet: these screens become the baseline when this run is signed off.</>}
          {v.skipped && <span className="text-warn"> {v.skipped}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={onlyChanged} onChange={e => setOnlyChanged(e.target.checked)} /> Only tests with changes</label>
          <div role="radiogroup" aria-label="How to compare" className="flex overflow-hidden rounded-md border border-line">
            {([['side', 'Side by side'], ['diff', 'Difference']] as [Mode, string][]).map(([m, label]) => (
              <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                className={`px-2.5 py-1 ${mode === m ? 'bg-accent text-accent-ink' : 'bg-surface text-muted hover:text-ink'}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      {tests.map(t => <TestCard key={t.test_id} t={t} mode={mode} onlyChanged={onlyChanged} />)}
      {!tests.length && <Empty>No test matches.</Empty>}
    </div>
  );
}

function TestCard({ t, mode, onlyChanged }: { t: TestShots; mode: Mode; onlyChanged: boolean }) {
  const [open, setOpen] = useState(t.counts.changed > 0);
  const steps = onlyChanged ? t.steps.filter(s => s.status === 'changed') : t.steps;
  const comments = t.steps.filter(s => s.ai);
  return (
    <Card title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{t.test_id}</span> {t.title}
      {t.result && <Pill value={t.result} />}{t.recommendation && <Pill value={t.recommendation} />}</span>}
      actions={<button className="text-sm text-link hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : 'Show'} {t.steps.length} screen(s)</button>}>
      <div className="flex flex-wrap gap-2 text-xs">
        {t.counts.changed > 0 && <Pill value="CONCERNS" label={`${t.counts.changed} changed`} />}
        {t.counts.unchanged > 0 && <Pill value="ok" label={`${t.counts.unchanged} unchanged`} />}
        {t.counts.new > 0 && <Pill value="-" label={`${t.counts.new} new (no baseline)`} />}
        {comments.length > 0 && <span className="text-muted">AI comments on {comments.length} screen(s)</span>}
      </div>
      {comments.length > 0 && (
        <ul className="mt-3 grid gap-1 text-sm">
          {comments.map(s => <li key={s.name}><Pill value={s.ai!.label} /> <span className="text-muted">Step {s.step}:</span> {s.ai!.note}</li>)}
        </ul>
      )}
      {open && <div className="mt-4 grid gap-6">{steps.map(s => <StepCompare key={s.name} s={s} mode={mode} />)}</div>}
    </Card>
  );
}

function StepCompare({ s, mode }: { s: StepShot; mode: Mode }) {
  const effective: Mode = !s.old ? 'side' : mode === 'diff' && !s.diff ? 'side' : mode;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <b className="tnum">Step {s.step}</b>
        <span className="text-sm">{s.step_text}</span>
        <Pill value={s.status === 'changed' ? 'CONCERNS' : s.status === 'unchanged' ? 'ok' : '-'} label={s.status} />
        {s.changed_pixels !== undefined && s.status === 'changed' && <span className="text-xs text-muted tnum">{s.changed_pixels.toLocaleString()} changed pixels</span>}
        {s.note && <span className="text-xs text-warn">{s.note}</span>}
      </div>
      {s.expected.length > 0 && <p className="text-xs text-muted">Expected: {s.expected.join(' · ')}</p>}
      {s.ai && <p className="rounded-md bg-surface-2 px-3 py-2 text-sm"><Pill value={s.ai.label} /> <b>AI reviewer:</b> {s.ai.note}</p>}
      {effective === 'side' && (
        <div className={`grid grid-cols-1 gap-2 ${s.old ? (s.diff ? 'lg:grid-cols-3' : 'md:grid-cols-2') : ''}`}>
          {s.old && <Shot src={s.old} caption="Last signed-off" />}
          <Shot src={s.new} caption="This run" />
          {s.old && s.diff && <Shot src={s.diff} caption="Difference (changed pixels in red)" />}
        </div>
      )}
      {effective === 'diff' && s.diff && <Shot src={s.diff} caption="Difference (changed pixels in red)" />}
    </div>
  );
}

function Shot({ src, caption }: { src: string; caption: string }) {
  return <Screenshot src={kitFile(src)} caption={caption} />;
}
