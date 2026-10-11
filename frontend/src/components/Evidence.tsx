import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, runFile, type RunDetail } from '../api';
import type { CheckedTest, ProgressTest } from '../types/run';
import { Button, Loading, Notice, Pill, errorText } from '../ui';

/** A test passed when its result says so; everything else (failed, timed out, not run) is worth a look. */
export const isProblem = (result?: string) => !!result && result !== 'passed' && result !== 'manual';

/** Every file of one evidence folder, fetched once per run and shared by every panel. */
function useEvidenceFiles(runId: string, folder: string) {
  return useQuery({ queryKey: ['files', runId, folder], queryFn: () => api.get<string[]>(`/api/runs/${runId}/files?folder=${encodeURIComponent(folder)}`),
    staleTime: 30_000 });
}

/**
 * The evidence of one test, where the person is looking: one screenshot per Excel step with the step's text,
 * the failure and its diagnosis, and the trace and video. Playwright's own copies of the screenshots are left
 * out (Studio's per-step screenshots are the evidence).
 */
export function TestEvidence({ runId, r, testId }: { runId: string; r: RunDetail; testId: string }) {
  const d = r.data;
  const t: Partial<ProgressTest> = d.progress?.tests?.[testId] ?? {};
  const check: Partial<CheckedTest> = d.evidence_check?.tests?.[testId] ?? {};
  const diag = d.diagnoses?.[testId];
  const kase = (d.cases ?? []).find((c: any) => c.test_id === testId);
  const folder = t.evidence ?? 'evidence';
  const files = useEvidenceFiles(runId, folder);
  const [msg, setMsg] = useState('');
  const [opening, setOpening] = useState(false);

  const shots = (files.data ?? [])
    .map(f => ({ f, m: f.match(new RegExp(`/screenshots/${testId}-step(\\d+)\\.png$`)) }))
    .filter(x => x.m).map(x => ({ file: x.f, step: Number(x.m![1]) })).sort((a, b) => a.step - b.step);
  const own = (files.data ?? []).filter(f => f.includes('/test-output/') && f.includes(`${testId}-`));
  const trace = own.find(f => f.endsWith('trace.zip'));
  const video = own.find(f => f.endsWith('.webm'));
  const steps: { n: number; text: string }[] = kase?.steps ?? [];
  const expectedOf = (n: number) => (kase?.expected_results ?? []).filter((e: any) => Number(e.step) === n).map((e: any) => e.text);
  const missing = steps.filter(s => !shots.some(x => x.step === s.n));

  return (
    <div className="grid gap-3 rounded-lg border border-line bg-surface-2/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{testId}</span>
        {kase?.title && <span className="text-sm">{kase.title}</span>}
        <Pill value={t.result ?? check.result ?? '-'} />
        {check.recommendation && <Pill value={check.recommendation} />}
        <span className="ml-auto flex gap-2">
          {trace && <Button kind="ghost" busy={opening} disabled={opening} onClick={async () => {
            setOpening(true); setMsg('');
            try { await api.post(`/api/runs/${runId}/open-trace`, { path: trace }); setMsg('The trace viewer opens in a new window on this machine.'); }
            catch (e) { setMsg(errorText(e)); } finally { setOpening(false); }
          }}>{opening ? 'Opening…' : 'Open trace'}</Button>}
          {video && <a className="rounded-md px-2 py-1 text-sm text-accent hover:underline" href={runFile(runId, video)} target="_blank" rel="noreferrer">Video</a>}
        </span>
      </div>
      {msg && <p className="text-xs text-muted">{msg}</p>}

      {isProblem(t.result) && (t.error || diag) && (
        <div className="grid gap-1 rounded-md border border-bad/40 bg-bad/5 p-2.5 text-sm">
          {t.error && <div><b>Failed:</b> <span className="font-mono text-xs">{t.error}</span></div>}
          {diag && <div><b>Diagnosis{diag.cause ? ` (${String(diag.cause).replace('_', ' ')})` : ''}:</b> {diag.summary}</div>}
        </div>
      )}

      {files.isPending ? <Loading label="Loading screenshots…" />
        : files.isError ? <Notice>{errorText(files.error)}</Notice>
        : shots.length === 0 ? <p className="text-sm text-muted">No screenshots for this test{t.result ? '' : ' (it has not run)'}.</p>
        : (
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shots.map(s => {
              const step = steps.find(x => x.n === s.step);
              return (
                <li key={s.file} className="grid content-start gap-1.5">
                  <a href={runFile(runId, s.file)} target="_blank" rel="noreferrer" title="Open full size">
                    <img src={runFile(runId, s.file)} alt={`${testId} step ${s.step}`} loading="lazy" className="w-full rounded-md border border-line bg-surface" />
                  </a>
                  <div className="text-xs"><b className="tnum">Step {s.step}.</b> {step?.text ?? ''}</div>
                  {expectedOf(s.step).map((e: string, i: number) => <div key={i} className="text-xs text-muted">Expected: {e}</div>)}
                </li>
              );
            })}
          </ol>
        )}
      {shots.length > 0 && missing.length > 0 && (
        <p className="text-xs text-bad">No screenshot for step {missing.map(s => s.n).join(', ')}: the test stopped before reaching {missing.length > 1 ? 'them' : 'it'}.</p>
      )}
    </div>
  );
}
