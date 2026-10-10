import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, runFile, type RunDetail } from '../api';
import { Activity } from '../components/Activity';
import { NeedsYou } from '../components/NeedsYou';
import { Signoff } from '../components/Signoff';
import { VisualRegression } from '../components/VisualRegression';
import { Button, Card, Empty, Pill, Pre, Table, Tabs, errorText, inputCls, useEvents } from '../ui';

export function RunPage() {
  const { runId = '' } = useParams();
  const qc = useQueryClient();
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => api.get<RunDetail>(`/api/runs/${runId}`), refetchInterval: 5000 });
  const events = useEvents(`/api/runs/${runId}/events`, [['run', runId], ['interactions']]);
  const [tab, setTab] = useState('activity');
  const [stage, setStage] = useState<string | undefined>();
  const [visualFocus, setVisualFocus] = useState<string | null>(null);
  const [error, setError] = useState('');
  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); qc.invalidateQueries({ queryKey: ['run', runId] }); } catch (e) { setError(errorText(e)); }
  };
  const r = run.data;
  if (run.isError) return <Empty>{errorText(run.error)}</Empty>;
  if (!r) return <Empty>Loading…</Empty>;
  const d = r.data;
  const prog = d.progress ?? {};
  const tests = prog.tests ?? {};
  const failedStage = r.stages.find(s => s.status === 'failed' || s.status === 'waiting_for_person');
  const tabs = [
    { id: 'activity', label: 'Activity' }, { id: 'cases', label: 'Cases' }, { id: 'changes', label: 'Changes & questions' },
    { id: 'tests', label: 'Tests' }, { id: 'results', label: 'Results' }, { id: 'failures', label: 'Failures' },
    { id: 'console', label: 'Console' }, { id: 'visual', label: 'Visual regression', badge: d.screens?.flagged?.length ?? 0 }, { id: 'signoff', label: 'Sign-off', badge: r.pending.some(p => p.kind === 'signoff') ? 1 : 0 },
    { id: 'usage', label: 'Usage' }, { id: 'files', label: 'Files' },
  ];
  return (
    <div className="mx-auto grid max-w-7xl gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold">{r.id}</h1>
          <p className="text-sm text-muted">{prog.excel} · strictness {prog.strictness}{prog.excel_sha256 ? ` · SHA-256 ${String(prog.excel_sha256).slice(0, 12)}…` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {r.running
            ? <Button kind="danger" onClick={() => act(() => api.post(`/api/runs/${runId}/stop`))}>Stop</Button>
            : <Button kind="primary" onClick={() => act(() => api.post(`/api/runs/${runId}/start`))}>{prog.stages && Object.keys(prog.stages).length ? 'Resume' : 'Start'}</Button>}
          {!r.running && failedStage && <Button onClick={() => act(() => api.post(`/api/runs/${runId}/retry`, { stage: failedStage.id }))}>Retry {failedStage.id}</Button>}
          {d.cases && <a className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2" href={`/api/runs/${runId}/clarified.xlsx`}
            title="The cases as clarified, in the template: paste them back into your Excel">Clarified Excel</a>}
          {r.results_ready && <a className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink" href={`/api/runs/${runId}/results.xlsx`}>Download results.xlsx</a>}
        </div>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}

      <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        {r.stages.map((s, n) => (
          <li key={s.id}>
            <button onClick={() => { setStage(stage === s.id ? undefined : s.id); setTab('activity'); }}
              className={`w-full rounded-md border px-2.5 py-2 text-left ${stage === s.id ? 'border-accent' : 'border-line'} ${s.on ? 'bg-surface' : 'bg-surface-2 opacity-70'}`}
              title={s.does || s.note}>
              <div className="flex items-center justify-between gap-1"><span className="text-xs text-muted tnum">{n + 1}</span><Pill value={s.on ? s.status : 'off'} /></div>
              <div className="mt-1 truncate text-sm font-medium">{s.id.replace('_', ' ')}</div>
              {s.note && <div className="truncate text-xs text-muted">{s.note}</div>}
            </button>
          </li>
        ))}
      </ol>

      <NeedsYou items={r.pending} onSignoff={() => setTab('signoff')} />

      <Tabs tabs={tabs} current={tab} onChange={setTab} />
      {tab === 'activity' && <Activity events={events} stage={stage} />}
      {tab === 'cases' && <Cases d={d} />}
      {tab === 'changes' && <Changes r={r} />}
      {tab === 'tests' && <TestsTab d={d} />}
      {tab === 'results' && <Results runId={runId} d={d} tests={tests} onVisual={id => { setVisualFocus(id); setTab('visual'); }} />}
      {tab === 'failures' && <Failures r={r} />}
      {tab === 'console' && <Console r={r} />}
      {tab === 'visual' && <>
        {visualFocus && <p className="text-sm">Showing {visualFocus} only · <button className="text-accent hover:underline" onClick={() => setVisualFocus(null)}>show every test</button></p>}
        <VisualRegression runId={runId} focus={visualFocus} />
      </>}
      {tab === 'signoff' && <Signoff runId={runId} r={r} />}
      {tab === 'usage' && <Usage d={d} />}
      {tab === 'files' && <Files runId={runId} />}
    </div>
  );
}

function Cases({ d }: { d: Record<string, any> }) {
  const cases: any[] = d.cases ?? [];
  if (!cases.length) return <Empty>The Excel has not been read yet.</Empty>;
  return (
    <Card title={`${cases.length} test cases`}>
      {d.studio_validation?.output && <Pre className="mb-3 text-bad">{d.studio_validation.output}</Pre>}
      <Table head={['Test ID', 'Group', 'Title', 'Login as', 'Steps', 'Expected results', 'State']} rows={cases.map(c => [
        <span className="font-mono">{c.test_id}</span>, c.group, c.title, c.login_as || '—',
        <ol className="list-decimal pl-4">{(c.steps ?? []).map((s: any) => <li key={s.n}>{s.text}</li>)}</ol>,
        <ul>{(c.expected_results ?? []).map((e: any, i: number) => <li key={i}><span className="text-muted tnum">{e.step}.</span> {e.text}</li>)}</ul>,
        <div className="flex flex-wrap gap-1">
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
      <Card title={open ?? 'Test code'}>{open ? <Pre className="max-h-[70vh] overflow-y-auto">{file.data?.text ?? 'Loading…'}</Pre> : <Empty>Pick a test file to read it.</Empty>}</Card>
    </div>
  );
}

function Results({ runId, d, tests, onVisual }: { runId: string; d: Record<string, any>; tests: Record<string, any>; onVisual: (id: string) => void }) {
  const screensOf = (id: string) => (d.screens?.pairs ?? d.screens?.flagged ?? []).filter((p: any) => p.test_id === id);
  const [traceMsg, setTraceMsg] = useState('');
  const check = d.evidence_check?.tests ?? {};
  const [pick, setPick] = useState<string | null>(null);
  const t = pick ? tests[pick] : null;
  const files = useQuery({ queryKey: ['files', runId, t?.evidence], queryFn: () => api.get<string[]>(`/api/runs/${runId}/files?folder=${encodeURIComponent(t!.evidence ?? 'evidence')}`), enabled: !!t });
  const ids = Array.from(new Set([...Object.keys(tests), ...Object.keys(check)]));
  if (!ids.length) return <Empty>No results yet.</Empty>;
  const mine = (files.data ?? []).filter(f => pick && (f.includes(`/${pick}-`) || f.includes(`${pick}-`) || f.toLowerCase().includes(pick.toLowerCase())));
  return (
    <div className="grid gap-4">
      <Card title="Results and evidence">
        <Table head={['Test', 'Result', 'Recommendation', 'Screenshots', 'Trace', 'Visual', 'Why / missing']} rows={ids.map(id => [
          <button className="font-mono text-accent hover:underline" onClick={() => setPick(id)}>{id}</button>,
          <Pill value={tests[id]?.result ?? check[id]?.result ?? '-'} />,
          check[id] ? <Pill value={check[id].recommendation} /> : '—',
          check[id]?.screenshots ?? '—', check[id]?.trace ? 'yes' : '—',
          screensOf(id).length ? <button className="text-accent hover:underline" onClick={() => onVisual(id)}>
            {screensOf(id).filter((p: any) => p.status === 'changed' || p.changed_pixels).length} changed / {screensOf(id).length}</button> : '—',
          <span className="text-xs">{[...(check[id]?.reasons ?? []), ...(check[id]?.missing ?? []), tests[id]?.error].filter(Boolean).join('; ')}</span>,
        ])} />
      </Card>
      {pick && t && (
        <Card title={`${pick} · evidence in ${t.evidence}`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {mine.filter(f => f.endsWith('.png')).map(f => (
              <figure key={f} className="grid gap-1"><a href={runFile(runId, f)} target="_blank" rel="noreferrer">
                <img src={runFile(runId, f)} alt={f} className="rounded border border-line" loading="lazy" /></a>
                <figcaption className="font-mono text-xs text-muted">{f.split('/').pop()}</figcaption></figure>
            ))}
          </div>
          <ul className="mt-3 grid gap-1 text-sm">
            {(files.data ?? []).filter(f => /\.(zip|webm)$/.test(f)).filter(f => f.toLowerCase().includes(pick.toLowerCase())).map(f =>
              <li key={f}><a className="text-accent hover:underline" href={runFile(runId, f)}>{f.endsWith('.zip') ? 'Trace' : 'Video'}: {f}</a>
                {f.endsWith('.zip') && <> <Button kind="ghost" onClick={async () => { try { await api.post(`/api/runs/${runId}/open-trace`, { path: f }); setTraceMsg('The trace viewer opens in a new window on this machine.'); } catch (e) { setTraceMsg(errorText(e)); } }}>Open in trace viewer</Button></>}</li>)}
          </ul>
          {traceMsg && <p className="mt-2 text-sm text-muted">{traceMsg}</p>}
        </Card>
      )}
    </div>
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
        <Button kind="primary" disabled={!reason.trim() || !pattern.trim()} onClick={async () => {
          try {
            const code = String(group.message).match(/^(\d{3}) /)?.[1];   // filter_console: "404 /path"
            const status = network && code ? [Number(code)] : [];
            await api.post('/api/kit/console-noise', { kind: network ? 'network' : 'console', pattern, reason, status });
            setState('saved');
          } catch (e) { setState(errorText(e)); }
        }}>Add</Button>
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
      <ul className="grid gap-0.5 font-mono text-xs">
        {(files.data ?? []).map(f => <li key={f}><a className="text-accent hover:underline" href={runFile(runId, f)} target="_blank" rel="noreferrer">{f}</a></li>)}
      </ul>
    </Card>
  );
}
