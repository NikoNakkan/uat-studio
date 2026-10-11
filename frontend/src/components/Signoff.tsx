import { Fragment, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type RunDetail } from '../api';
import { readStored, writeStored } from '../lib/storage';
import { useAction } from '../lib/useAction';
import { TestEvidence, isProblem } from './Evidence';
import { Button, Card, Empty, Field, Pill, Table, inputCls } from '../ui';

/** The AI recommends, a person decides (decisions 6 and 21). Every decision runs record_decision.py. */
export function Signoff({ runId, r }: { runId: string; r: RunDetail }) {
  const qc = useQueryClient();
  const check = r.data.evidence_check;
  const signoff = r.data.signoff ?? { decisions: {}, manual: {} };
  const reasoning = r.data.studio_reasoning ?? {};
  const manifest = r.data.manifest;
  const sealed = !!manifest;
  const [by, setBy] = useState(() => readStored('uat-signoff-by') ?? '');
  const [info, setInfo] = useState('');
  const { busy: busyKey, error, run } = useAction();
  const [open, setOpen] = useState<{ unit: string; test: string } | null>(null);   // the test whose evidence is shown
  const results = r.data.progress?.tests ?? {};
  if (!check) return <Empty>The evidence is checked when the run reaches sign-off.</Empty>;

  const post = (key: string, url: string, body: unknown) => run(key, async () => {
    setInfo('');
    const res = await api.post<{ output: string }>(url, body);
    setInfo(res.output);
    qc.invalidateQueries({ queryKey: ['run', runId] });
  });
  const units = Object.entries(check.units ?? {});
  const manual = Object.entries(check.tests ?? {}).filter(([, t]) => t.recommendation === 'MANUAL');
  const decidedUnits = units.filter(([unit]) => signoff.decisions?.[unit]).length;
  const recordedManual = manual.filter(([id]) => signoff.manual?.[id]).length;
  const readyToClose = decidedUnits === units.length && recordedManual === manual.length;

  return (
    <div className="grid gap-4">
      <Card title={sealed ? `Signed off and sealed on ${manifest?.sealed_at}` : `Sign-off per ${check.sign_off_unit}`}
        actions={!sealed && <Field label="Decided by" hint={by.trim() ? undefined : 'Enter your name to record decisions.'}>
          <input className={`${inputCls} ${by.trim() ? '' : 'border-warn ring-1 ring-warn/40'}`} value={by} placeholder="Your name" aria-required
            onChange={e => { setBy(e.target.value); writeStored('uat-signoff-by', e.target.value); }} /></Field>}>
        <p className="mb-2 text-xs text-muted">✦ marks the AI's recommendation. You decide; every decision is recorded with your name.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted">
              {['Unit', 'Tests (click for evidence)', 'AI recommendation', 'Reasoning', 'Decision'].map(h => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {units.map(([unit, u]) => {
                const shown = open && open.unit === unit ? open.test : null;
                return (
                  <Fragment key={unit}>
                    <tr className="border-b border-line/60 align-top">
                      <td className="px-2 py-2 font-semibold">{unit}</td>
                      <td className="px-2 py-2">
                        <div className="flex max-w-64 flex-wrap gap-1">
                          {u.tests.map((id: string) => {
                            const bad = isProblem(results[id]?.result);
                            const on = shown === id;
                            return (
                              <button key={id} type="button" aria-pressed={on} onClick={() => setOpen(on ? null : { unit, test: id })}
                                title={bad ? `${id} did not pass: see why` : `See ${id}'s screenshots`}
                                className={`rounded-md border px-1.5 py-0.5 font-mono text-xs ${on ? 'border-accent bg-accent text-accent-ink'
                                  : bad ? 'border-bad/60 bg-bad/10 font-semibold text-bad hover:bg-bad/20' : 'border-line bg-surface hover:border-accent'}`}>
                                {bad ? '! ' : ''}{id}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-2 py-2"><Pill value={u.recommendation} /></td>
                      <td className="px-2 py-2 text-sm">{reasoning[unit] ?? ''}</td>
                      <td className="px-2 py-2">{signoff.decisions[unit]
                        ? <span><Pill value={signoff.decisions[unit].decision} /> <span className="text-xs text-muted">by {signoff.decisions[unit].by}{signoff.decisions[unit].reason ? ` · ${signoff.decisions[unit].reason}` : ''}</span></span>
                        : sealed ? '—' : <Decide unit={unit} suggested={u.recommendation} busy={busyKey === `d:${unit}`} disabled={!by.trim() || !!busyKey} onDecide={(decision, reason) =>
                            post(`d:${unit}`, `/api/runs/${runId}/signoff/decision`, { unit, decision, by, reason })} />}</td>
                    </tr>
                    {shown && <tr><td colSpan={5} className="px-2 pb-3"><TestEvidence runId={runId} r={r} testId={shown} /></td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {manual.length > 0 && (
        <Card title={`Manual cases · ${manual.length}`}>
          <Table head={['Test', 'Title', 'Result']} rows={manual.map(([id, t]) => [
            <span className="font-mono">{id}</span>, t.title,
            signoff.manual?.[id]
              ? <span><Pill value={signoff.manual[id].result} /> <span className="text-xs text-muted">by {signoff.manual[id].by}{signoff.manual[id].evidence ? ` · proof: ${signoff.manual[id].evidence}` : ''}</span></span>
              : sealed ? '—' : <ManualResult busy={busyKey === `m:${id}`} disabled={!by.trim() || !!busyKey} onSave={(result, note, evidence) =>
                  post(`m:${id}`, `/api/runs/${runId}/signoff/manual`, { test_id: id, result, by, note, evidence })} />,
          ])} />
        </Card>
      )}

      {!sealed && (
        <Card title="Close the sign-off">
          <p className="mb-3 text-sm text-muted">Closing seals the run: every file the decisions rest on is hashed into manifest.json and results.xlsx is written. New results need a new run.</p>
          <ul className="mb-3 grid gap-1 text-sm" aria-label="Before closing">
            {[
              { done: !!by.trim(), text: by.trim() ? `Decided by: ${by.trim()}` : 'Enter your name in "Decided by" at the top' },
              { done: decidedUnits === units.length, text: `Groups recorded: ${decidedUnits} of ${units.length} (press Record on each row)` },
              ...(manual.length ? [{ done: recordedManual === manual.length, text: `Manual cases recorded: ${recordedManual} of ${manual.length}` }] : []),
            ].map(c => (
              <li key={c.text} className={`flex items-center gap-2 ${c.done ? 'text-good' : 'text-ink'}`}>
                <span aria-hidden className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${c.done ? 'bg-good text-white' : 'border border-line'}`}>{c.done ? '✓' : ''}</span>
                {c.text}
              </li>
            ))}
          </ul>
          <Button kind="primary" busy={busyKey === 'complete'} disabled={!!busyKey || !readyToClose}
            title={readyToClose ? undefined : 'Finish the list above first'}
            onClick={() => post('complete', `/api/runs/${runId}/signoff/complete`, {})}>{busyKey === 'complete' ? 'Closing…' : 'Close sign-off and write results'}</Button>
        </Card>
      )}
      {r.results_ready && <a className="justify-self-start rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:brightness-95" href={`/api/runs/${runId}/results.xlsx`}>Download results.xlsx</a>}
      {info && <pre role="status" className="text-sm text-good">{info}</pre>}
      {error && <pre role="alert" className="text-sm text-bad">{error}</pre>}
    </div>
  );
}

const DECISIONS = [
  { value: 'PASS', on: 'bg-good text-white border-good' },
  { value: 'CONCERNS', on: 'bg-warn text-white border-warn' },
  { value: 'FAIL', on: 'bg-bad text-white border-bad' },
  { value: 'WAIVED', on: 'bg-ink text-surface border-ink' },
];

/** One decision per unit: four buttons (the AI's recommendation picked and marked), a reason, Record. */
function Decide({ unit, suggested, disabled, busy, onDecide }: { unit: string; suggested: string; disabled: boolean; busy?: boolean; onDecide: (d: string, reason: string) => void }) {
  const [decision, setDecision] = useState(suggested === 'MANUAL' ? 'PASS' : suggested);
  const [reason, setReason] = useState('');
  const needsReason = decision === 'WAIVED' && !reason.trim();
  return (
    <div className="grid min-w-[19rem] gap-2">
      <div role="radiogroup" aria-label={`Decision for ${unit}`} className="flex flex-wrap gap-1">
        {DECISIONS.map(d => (
          <button key={d.value} type="button" role="radio" aria-checked={decision === d.value} onClick={() => setDecision(d.value)}
            title={d.value === suggested ? 'The AI recommends this' : undefined}
            className={`rounded-md border px-2 py-1 text-xs font-semibold ${decision === d.value ? d.on : 'border-line bg-surface text-muted hover:text-ink'}`}>
            {d.value}{d.value === suggested ? ' ✦' : ''}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input className={`${inputCls} min-w-0 flex-1`} aria-label={`Reason for ${unit}`}
          placeholder={decision === 'WAIVED' ? 'Why is this accepted? (required)' : 'Reason (optional)'} value={reason} onChange={e => setReason(e.target.value)} />
        <Button kind="primary" busy={busy} disabled={disabled || needsReason} title={disabled ? 'Enter your name at the top first' : needsReason ? 'A waiver needs a reason' : undefined}
          onClick={() => onDecide(decision, reason)}>{busy ? 'Recording…' : 'Record'}</Button>
      </div>
    </div>
  );
}

function ManualResult({ disabled, busy, onSave }: { disabled: boolean; busy?: boolean; onSave: (r: string, note: string, evidence: string) => void }) {
  const [result, setResult] = useState('PASS');
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState('');
  return (
    <div className="grid gap-1.5 sm:grid-cols-[auto_1fr_1fr_auto]">
      <select className={inputCls} value={result} onChange={e => setResult(e.target.value)}>{['PASS', 'FAIL', 'NOT_RUN'].map(v => <option key={v}>{v}</option>)}</select>
      <input className={inputCls} placeholder="Note" value={note} onChange={e => setNote(e.target.value)} />
      <input className={inputCls} placeholder="Where the proof is" value={evidence} onChange={e => setEvidence(e.target.value)} />
      <Button kind="primary" busy={busy} disabled={disabled} onClick={() => onSave(result, note, evidence)}>{busy ? 'Recording…' : 'Record'}</Button>
    </div>
  );
}
