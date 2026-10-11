import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, runFile, type RunDetail, type StageRow } from '../api';
import { TestEvidence, isProblem } from '../components/Evidence';
import { RunActions } from '../components/RunActions';
import { Signoff } from '../components/Signoff';
import { Stepper, type StepDef, type StepState } from '../components/Stepper';
import { VisualRegression } from '../components/VisualRegression';
import { Button, Card, Empty, Loading, MsgNotice, Notice, Pill, Pre, QueryGate, Shot, Table, errorText, fail, inputCls, ok, useTitle, type Msg } from '../ui';

/** What each stage is called and what it is for, in words a test author uses. */
const STAGES: Record<string, { title: string; about: string }> = {
  preflight: { title: 'Check the setup', about: 'Machine, app under test and login are ready.' },
  intake: { title: 'Read the Excel', about: 'Reads every case and checks it follows the template.' },
  clarify: { title: 'Clarify the cases', about: 'Asks you about anything vague, so no expected value is invented.' },
  plan: { title: 'Write the plan', about: 'Turns the cases into Playwright plans and proves the accounts log in.' },
  planner_check: { title: 'Check steps in the live app', about: 'Playwright tries each step in your app and records the real names on screen.' },
  generate: { title: 'Write the tests', about: 'One Playwright test per new or changed case, written in the live app.' },
  test_check: { title: 'Check the tests', about: 'Each test must match its Excel row exactly, and pass three times in a row.' },
  run: { title: 'Run the tests', about: 'Plain Playwright, no AI: screenshots per step, a trace and the console.' },
  console_review: { title: 'Console and network errors', about: 'New errors since the last run, explained.' },
  failures: { title: 'Explain failures', about: 'Each failure is reproduced and called a bug, a broken test or the environment.' },
  screens: { title: 'Compare screens', about: 'Screenshots against the last accepted run.' },
  signoff: { title: 'Sign off', about: 'You decide each result, with the evidence next to it.' },
};

function stageState(s: StageRow, waiting: boolean): StepState {
  if (!s.on) return 'off';
  if (s.status === 'waiting_for_person' || waiting) return 'waiting';
  if (s.status === 'running') return 'current';
  if (s.status === 'failed') return 'failed';
  if (s.status === 'done' || s.status === 'skipped') return 'done';
  return 'todo';
}

export function RunPage() {
  const { runId = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => api.get<RunDetail>(`/api/runs/${runId}`), refetchInterval: 5000 });
  const [visualFocus, setVisualFocus] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  const actingLock = useRef(false);
  const act = async (id: string, fn: () => Promise<unknown>) => {
    if (actingLock.current) return;
    actingLock.current = true;
    setActing(id); setError('');
    try { await fn(); qc.invalidateQueries({ queryKey: ['run', runId] }); } catch (e) { setError(errorText(e)); }
    finally { actingLock.current = false; setActing(null); }
  };
  const r = run.data;
  useTitle(r?.id ?? 'Run');
  if (run.isError) return <Notice>{errorText(run.error)}</Notice>;
  if (!r) return <Loading label="Loading this run…" />;
  const d = r.data;
  const prog = d.progress ?? {};
  const tests = prog.tests ?? {};
  const failedStage = r.stages.find(s => s.status === 'failed' || s.status === 'waiting_for_person');
  // Questions carry no stage; they belong to the stage that is running (stages run one after another).
  const activeId = r.stages.find(s => s.status === 'running' || s.status === 'waiting_for_person')?.id;

  const output = (id: string): ReactNode => {
    switch (id) {
      case 'intake': return d.cases ? <Cases d={d} /> : null;
      case 'clarify': return d.cases ? <Changes r={r} /> : null;
      case 'planner_check': return r.texts['mismatches.md'] ? <Card title="Mismatches"><Pre>{r.texts['mismatches.md']}</Pre></Card> : null;
      case 'test_check': return d.test_check ? <TestsTab d={d} /> : null;
      case 'run': return Object.keys(tests).length ? <Results runId={runId} r={r} tests={tests} onVisual={id => setVisualFocus(id)} /> : null;
      case 'console_review': return d.console_new || r.texts['console.md'] ? <Console r={r} /> : null;
      case 'failures': return d.diagnoses ? <Failures r={r} /> : null;
      case 'screens': return d.screens ? <>
        {visualFocus && <p className="text-sm">Showing {visualFocus} only · <button className="text-accent hover:underline" onClick={() => setVisualFocus(null)}>show every test</button></p>}
        <VisualRegression runId={runId} focus={visualFocus} />
      </> : null;
      case 'signoff': return d.evidence_check ? <Signoff runId={runId} r={r} /> : null;
      default: return null;
    }
  };

  const steps: StepDef[] = r.stages.map(s => {
    const meta = STAGES[s.id] ?? { title: s.id.replace(/_/g, ' '), about: s.does };
    const state = stageState(s, s.id === activeId && r.pending.length > 0);
    const out = output(s.id);
    return {
      id: s.id, title: meta.title, state,
      summary: state === 'waiting' ? 'Waiting for you. Answer in the live panel.' : s.note || meta.about,
      body: <>
        {out}
        {!out && <p className="text-sm text-muted">The agent and its commands are in the live panel.</p>}
      </>,
    };
  });

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-accent hover:underline">← Test runs</Link>
          <h1 className="font-mono text-lg font-semibold">{r.id}</h1>
          <p className="text-sm text-muted">{prog.excel} · strictness {prog.strictness}{prog.excel_sha256 ? ` · SHA-256 ${String(prog.excel_sha256).slice(0, 12)}…` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!r.running && <Button kind="primary" busy={acting === 'start'} disabled={!!acting} onClick={() => act('start', () => api.post(`/api/runs/${runId}/start`))}>{acting === 'start' ? 'Starting…' : prog.stages && Object.keys(prog.stages).length ? 'Resume' : 'Start'}</Button>}
          <RunActions runId={runId} running={r.running} sealed={!!d.manifest} onDeleted={() => navigate('/')} />
          {!r.running && failedStage && <Button busy={acting === 'retry'} disabled={!!acting} onClick={() => act('retry', () => api.post(`/api/runs/${runId}/retry`, { stage: failedStage.id }))}>{acting === 'retry' ? 'Retrying…' : `Retry "${STAGES[failedStage.id]?.title ?? failedStage.id}"`}</Button>}
          {d.cases && <a className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2" href={`/api/runs/${runId}/clarified.xlsx`}
            title="The cases as clarified, in the template: paste them back into your Excel">Clarified Excel</a>}
          {r.results_ready && <a className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink" href={`/api/runs/${runId}/results.xlsx`}>Download results.xlsx</a>}
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      <Stepper label="Stages of this run" steps={steps} />
      <details className="rounded-lg border border-line bg-surface p-3 text-sm">
        <summary className="cursor-pointer font-medium">More: model usage and every file of this run</summary>
        <div className="mt-3 grid gap-4"><Usage d={d} /><Files runId={runId} /></div>
      </details>
    </div>
  );
}

function Cases({ d }: { d: Record<string, any> }) {
  const cases: any[] = d.cases ?? [];
  if (!cases.length) return <Empty>The Excel has not been read yet.</Empty>;
  return (
    <Card title={`${cases.length} test cases`}>
      {d.studio_validation?.output && <Pre className="mb-3 text-bad">{d.studio_validation.output}</Pre>}
      <Table resize={[12, 12, 14, 13, 16, 15, 18]} head={['Test ID', 'Group', 'Title', 'Login as', 'Steps', 'Expected results', 'State']} rows={cases.map(c => [
        <span className="font-mono">{c.test_id}</span>, c.group, c.title, c.login_as || '—',
        <ol className="list-decimal pl-4">{(c.steps ?? []).map((s: any) => <li key={s.n}>{s.text}</li>)}</ol>,
        <ul>{(c.expected_results ?? []).map((e: any, i: number) => <li key={i}><span className="text-muted tnum">{e.step}.</span> {e.text}</li>)}</ul>,
        <div className="flex min-w-0 max-w-full flex-wrap gap-1 [&_span]:max-w-full [&_span]:min-w-0 [&_span]:whitespace-normal">
          {String(c.automation || '').toLowerCase() === 'manual' && <Pill value="MANUAL" label="manual" />}
          {c.clarified && <Pill value="done" label="clarified" />}
          {c.open_questions && <Pill value="waiting" label="open questions" />}
          {c.carried_from && <Pill value="-" label={`carried from ${c.carried_from}`} />}
        </div>,
      ])} />
    </Card>
  );
}

function Changes({ r }: { r: RunDetail }) {
  const changes = r.data.changes?.cases ?? {};
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Changes since the last run">
        {Object.keys(changes).length ? <Table head={['Test ID', 'Status', 'Decision', 'Details']} rows={Object.entries(changes).map(([id, c]: any) => [
          <span className="font-mono">{id}</span>, c.status, c.decision ?? <span className="text-warn">to confirm</span>,
          [c.fields_changed?.join(', '), c.wording_only_candidate ? 'wording only?' : '', c.similar_to ? `similar to ${c.similar_to}` : ''].filter(Boolean).join(' · '),
        ])} /> : <Empty>No comparison yet.</Empty>}
      </Card>
      <div className="grid gap-4">
        {(['clarifications.md', 'questionnaire.md', 'mismatches.md', 'excel-updates.md'] as const).map(n => r.texts[n] &&
          <Card key={n} title={n}><Pre>{r.texts[n]}</Pre></Card>)}
        {!r.texts['clarifications.md'] && <Card title="Clarifications"><Empty>No questions asked yet.</Empty></Card>}
      </div>
    </div>
  );
}

function TestsTab({ d }: { d: Record<string, any> }) {
  const [open, setOpen] = useState<string | null>(null);
  const file = useQuery({ queryKey: ['kittext', open], queryFn: () => api.get<{ text: string }>(`/api/kit/text?path=${encodeURIComponent(open!)}`), enabled: !!open });
  const checks = d.test_check?.files ?? {};
  const flaky = d.flakiness ?? {};
  const gen: any[] = d.generate_list ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title="Test check">
        {Object.keys(checks).length ? <Table head={['Test file', 'Verdict', 'Stable', 'Problems']} rows={Object.entries(checks).map(([path, c]: any) => [
          <button className="font-mono text-left text-accent hover:underline" onClick={() => setOpen(path)}>{path}</button>,
          <Pill value={c.ok ? 'ACCEPT' : 'REJECT'} />,
          flaky[c.test_id] ? <Pill value={flaky[c.test_id].verdict} label={`${flaky[c.test_id].passed}/${flaky[c.test_id].runs}`} /> : '—',
          <ul className="text-xs">{(c.problems ?? []).map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>,
        ])} /> : <Empty>No tests checked yet.</Empty>}
        {gen.length > 0 && <p className="mt-3 text-xs text-muted">Generated in this run: {gen.map(g => g.test_id).join(', ')}</p>}
      </Card>
      <Card title={open ?? 'Test code'}>
        {!open ? <Empty>Pick a test file to read it.</Empty>
          : <QueryGate pending={file.isPending} error={file.isError ? file.error : null} label="Loading test code…">
              <Pre className="max-h-[70vh] overflow-y-auto">{file.data?.text}</Pre>
            </QueryGate>}
      </Card>
    </div>
  );
}

function Results({ runId, r, tests, onVisual }: { runId: string; r: RunDetail; tests: Record<string, any>; onVisual: (id: string) => void }) {
  const d = r.data;
  const screensOf = (id: string) => (d.screens?.pairs ?? d.screens?.flagged ?? []).filter((p: any) => p.test_id === id);
  const check = d.evidence_check?.tests ?? {};
  const [open, setOpen] = useState<string | null>(null);
  const titleOf = (id: string) => (d.cases ?? []).find((c: any) => c.test_id === id)?.title ?? '';
  // Problems first, then the rest in Test ID order, so what needs a look is at the top.
  const ids = Array.from(new Set([...Object.keys(tests), ...Object.keys(check)]))
    .sort((a, b) => Number(isProblem(tests[b]?.result)) - Number(isProblem(tests[a]?.result)) || a.localeCompare(b, undefined, { numeric: true }));
  if (!ids.length) return <Empty>No results yet.</Empty>;
  const problems = ids.filter(id => isProblem(tests[id]?.result)).length;
  return (
    <Card title={`Results and evidence · ${ids.length} tests${problems ? ` · ${problems} to look at` : ''}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-muted">
            {['Test', 'Result', 'Recommendation', 'Screenshots', 'Visual', 'Why / missing', ''].map((h, i) => <th key={i} className="px-2 py-1.5 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {ids.map(id => {
              const shown = open === id;
              const changed = screensOf(id);
              return (
                <Fragment key={id}>
                  <tr className={`border-b border-line/60 align-top ${isProblem(tests[id]?.result) ? 'bg-bad/5' : ''} ${shown ? 'bg-accent/5' : ''}`}>
                    <td className="whitespace-nowrap px-2 py-1.5"><span className="font-mono">{id}</span>
                      <div className="max-w-56 truncate text-xs text-muted" title={titleOf(id)}>{titleOf(id)}</div></td>
                    <td className="px-2 py-1.5"><Pill value={tests[id]?.result ?? check[id]?.result ?? '-'} /></td>
                    <td className="px-2 py-1.5">{check[id] ? <Pill value={check[id].recommendation} /> : '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tnum">{check[id]?.screenshots ?? '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{changed.length
                      ? <button className="text-accent hover:underline" onClick={() => onVisual(id)}>
                          {changed.filter((p: any) => p.status === 'changed' || p.changed_pixels).length} changed of {changed.length}</button> : '—'}</td>
                    <td className="px-2 py-1.5 text-xs">{[...(check[id]?.reasons ?? []), ...(check[id]?.missing ?? []), tests[id]?.error].filter(Boolean).join('; ')}</td>
                    <td className="px-2 py-1.5 text-right">
                      {tests[id]?.result && <Button kind={isProblem(tests[id]?.result) ? 'primary' : 'default'} onClick={() => setOpen(shown ? null : id)}>
                        {shown ? 'Hide' : 'Evidence'}</Button>}
                    </td>
                  </tr>
                  {shown && <tr><td colSpan={7} className="px-2 pb-3"><TestEvidence runId={runId} r={r} testId={id} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Failures({ r }: { r: RunDetail }) {
  const diag = r.data.diagnoses ?? {};
  return (
    <div className="grid gap-4">
      <Card title="Diagnoses">
        {Object.keys(diag).length ? <Table head={['Test', 'Cause', 'Reproduction', 'Repair', 'Summary']} rows={Object.entries(diag).map(([id, x]: any) => [
          <span className="font-mono">{id}</span>, x.cause ?? '—', x.reproduction ? `${x.reproduction}${x.reproduction_detail ? ` (${x.reproduction_detail})` : ''}` : '—',
          x.repair ?? '—', x.summary ?? x.error,
        ])} /> : <Empty>No failures diagnosed.</Empty>}
      </Card>
      {r.texts['diagnoses.md'] && <Card title="diagnoses.md"><Pre>{r.texts['diagnoses.md']}</Pre></Card>}
    </div>
  );
}

function Console({ r }: { r: RunDetail }) {
  const c = r.data.console_new;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={c ? `${c.groups.length} new error group(s) · ${c.captured} captured · ${c.ignored_as_noise} known noise` : 'Console and network errors'}>
        {c?.groups?.length ? <Table head={['Message', 'Kind', 'Where', 'In a failing test', '']} rows={c.groups.map((g: any) => [
          <span className="font-mono text-xs">{g.message}</span>, g.kind, g.where.map((w: any) => `${w.test_id} (${w.step})`).join(', '),
          g.in_failing_test ? 'yes' : 'hidden in passing tests', <NoiseButton group={g} />,
        ])} /> : <Empty>No new errors.</Empty>}
        <p className="mt-3 text-xs text-muted">Marking a message as known noise adds it to config/console-noise.yaml; future runs stop reporting it. Only a person does this.</p>
      </Card>
      <Card title="Console analyst (console.md)">{r.texts['console.md'] ? <Pre>{r.texts['console.md']}</Pre> : <Empty>No review yet.</Empty>}</Card>
    </div>
  );
}

/** A person accepts one error group as harmless noise (decision 31: the analyst only proposes). */
function NoiseButton({ group }: { group: any }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const network = group.kind !== 'console' && group.kind !== 'page error';
  const path: string = String(group.message).split(' ')[1] ?? group.message;            // "404 /favicon.ico" -> "/favicon.ico"
  const [pattern, setPattern] = useState<string>(network ? path : group.message.replace(/#/g, '').slice(0, 120));
  if (state === 'saved') return <span className="text-xs text-good">Added to known noise</span>;
  if (!open) return <Button kind="ghost" onClick={() => setOpen(true)}>Known harmless…</Button>;
  return (
    <div className="grid min-w-56 gap-1.5">
      <input className={inputCls} aria-label="Text to match" value={pattern} onChange={e => setPattern(e.target.value)} />
      <input className={inputCls} placeholder="Why it is harmless (required)" value={reason} onChange={e => setReason(e.target.value)} />
      <div className="flex gap-1.5">
        <Button kind="primary" busy={saving} disabled={!reason.trim() || !pattern.trim()} onClick={async () => {
          if (lock.current) return;
          lock.current = true;
          setSaving(true);
          try {
            const code = String(group.message).match(/^(\d{3}) /)?.[1];   // filter_console: "404 /path"
            const status = network && code ? [Number(code)] : [];
            await api.post('/api/kit/console-noise', { kind: network ? 'network' : 'console', pattern, reason, status });
            setState('saved');
          } catch (e) { setState(errorText(e)); }
          finally { lock.current = false; setSaving(false); }
        }}>{saving ? 'Adding…' : 'Add'}</Button>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      {state && state !== 'saved' && <span className="text-xs text-bad">{state}</span>}
    </div>
  );
}

function Usage({ d }: { d: Record<string, any> }) {
  const rows: any[] = d.usage ?? [];
  const totals = useMemo(() => {
    const t: Record<string, { input: number; output: number }> = {};
    for (const u of rows) { t[u.model] ??= { input: 0, output: 0 }; t[u.model].input += u.input_tokens; t[u.model].output += u.output_tokens; }
    return t;
  }, [rows]);
  if (!rows.length) return <Empty>No AI work recorded for this run yet.</Empty>;
  return (
    <Card title="Model and tokens per stage">
      <Table head={['Stage', 'Agent', 'Model', 'Input tokens', 'Output tokens', 'Source']} rows={[
        ...rows.map(u => [u.stage, u.agent, u.model, <span className="tnum">{u.input_tokens.toLocaleString()}</span>, <span className="tnum">{u.output_tokens.toLocaleString()}</span>, u.source]),
        ...Object.entries(totals).map(([m, t]) => [<b>Total</b>, '', m, <b className="tnum">{t.input.toLocaleString()}</b>, <b className="tnum">{t.output.toLocaleString()}</b>, '']),
      ]} />
    </Card>
  );
}

function Files({ runId }: { runId: string }) {
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
