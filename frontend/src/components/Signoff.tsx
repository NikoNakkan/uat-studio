import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type RunDetail } from '../api';
import { Button, Card, Empty, Field, Pill, Table, errorText, inputCls } from '../ui';

/** The AI recommends, a person decides (decisions 6 and 21). Every decision runs record_decision.py. */
export function Signoff({ runId, r }: { runId: string; r: RunDetail }) {
  const qc = useQueryClient();
  const check = r.data.evidence_check;
  const signoff = r.data.signoff ?? { decisions: {}, manual: {} };
  const reasoning = r.data.studio_reasoning ?? {};
  const sealed = !!r.data.manifest;
  const [by, setBy] = useState(() => localStorageGet('uat-signoff-by'));
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  if (!check) return <Empty>The evidence is checked when the run reaches sign-off.</Empty>;

  const post = async (url: string, body: unknown) => {
    setError(''); setInfo('');
    try {
      const res = await api.post<{ output: string }>(url, body);
      setInfo(res.output);
      qc.invalidateQueries({ queryKey: ['run', runId] });
    } catch (e) { setError(errorText(e)); }
  };
  const units = Object.entries(check.units ?? {}) as [string, any][];
  const manual = Object.entries(check.tests ?? {}).filter(([, t]: any) => t.recommendation === 'MANUAL') as [string, any][];

  return (
    <div className="grid gap-4">
      <Card title={sealed ? `Signed off and sealed on ${r.data.manifest.sealed_at}` : `Sign-off per ${check.sign_off_unit}`}
        actions={!sealed && <Field label="Decided by"><input className={inputCls} value={by} placeholder="Your name"
          onChange={e => { setBy(e.target.value); localStorageSet('uat-signoff-by', e.target.value); }} /></Field>}>
        <Table head={['Unit', 'Tests', 'AI recommendation', 'Reasoning', 'Decision']} rows={units.map(([unit, u]) => [
          <b>{unit}</b>, <span className="font-mono text-xs">{u.tests.join(', ')}</span>, <Pill value={u.recommendation} />,
          <span className="text-sm">{reasoning[unit] ?? ''}</span>,
          signoff.decisions[unit]
            ? <span><Pill value={signoff.decisions[unit].decision} /> <span className="text-xs text-muted">by {signoff.decisions[unit].by}{signoff.decisions[unit].reason ? ` · ${signoff.decisions[unit].reason}` : ''}</span></span>
            : sealed ? '—' : <Decide unit={unit} suggested={u.recommendation} disabled={!by.trim()} onDecide={(decision, reason) =>
                post(`/api/runs/${runId}/signoff/decision`, { unit, decision, by, reason })} />,
        ])} />
      </Card>

      {manual.length > 0 && (
        <Card title={`Manual cases · ${manual.length}`}>
          <Table head={['Test', 'Title', 'Result']} rows={manual.map(([id, t]) => [
            <span className="font-mono">{id}</span>, t.title,
            signoff.manual?.[id]
              ? <span><Pill value={signoff.manual[id].result} /> <span className="text-xs text-muted">by {signoff.manual[id].by}{signoff.manual[id].evidence ? ` · proof: ${signoff.manual[id].evidence}` : ''}</span></span>
              : sealed ? '—' : <ManualResult disabled={!by.trim()} onSave={(result, note, evidence) =>
                  post(`/api/runs/${runId}/signoff/manual`, { test_id: id, result, by, note, evidence })} />,
          ])} />
        </Card>
      )}

      {!sealed && (
        <Card title="Close the sign-off">
          <p className="mb-3 text-sm text-muted">Closing seals the run: every file the decisions rest on is hashed into manifest.json and results.xlsx is written. New results need a new run.</p>
          <Button kind="primary" onClick={() => post(`/api/runs/${runId}/signoff/complete`, {})}>Close sign-off and write results</Button>
        </Card>
      )}
      {r.results_ready && <a className="justify-self-start rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink" href={`/api/runs/${runId}/results.xlsx`}>Download results.xlsx</a>}
      {info && <pre className="text-sm text-good">{info}</pre>}
      {error && <pre className="text-sm text-bad">{error}</pre>}
    </div>
  );
}

function Decide({ unit, suggested, disabled, onDecide }: { unit: string; suggested: string; disabled: boolean; onDecide: (d: string, reason: string) => void }) {
  const [decision, setDecision] = useState(suggested === 'MANUAL' ? 'PASS' : suggested);
  const [reason, setReason] = useState('');
  return (
    <div className="grid gap-1.5">
      <div className="flex gap-1.5">
        <select aria-label={`Decision for ${unit}`} className={inputCls} value={decision} onChange={e => setDecision(e.target.value)}>
          {['PASS', 'CONCERNS', 'FAIL', 'WAIVED'].map(v => <option key={v}>{v}</option>)}
        </select>
        <Button kind="primary" disabled={disabled || (decision === 'WAIVED' && !reason.trim())} onClick={() => onDecide(decision, reason)}>Record</Button>
      </div>
      <input className={inputCls} placeholder={decision === 'WAIVED' ? 'Why is this accepted? (required)' : 'Reason (optional)'} value={reason} onChange={e => setReason(e.target.value)} />
      {disabled && <span className="text-xs text-muted">Enter your name first.</span>}
    </div>
  );
}

function ManualResult({ disabled, onSave }: { disabled: boolean; onSave: (r: string, note: string, evidence: string) => void }) {
  const [result, setResult] = useState('PASS');
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState('');
  return (
    <div className="grid gap-1.5 sm:grid-cols-[auto_1fr_1fr_auto]">
      <select className={inputCls} value={result} onChange={e => setResult(e.target.value)}>{['PASS', 'FAIL', 'NOT_RUN'].map(v => <option key={v}>{v}</option>)}</select>
      <input className={inputCls} placeholder="Note" value={note} onChange={e => setNote(e.target.value)} />
      <input className={inputCls} placeholder="Where the proof is" value={evidence} onChange={e => setEvidence(e.target.value)} />
      <Button kind="primary" disabled={disabled} onClick={() => onSave(result, note, evidence)}>Record</Button>
    </div>
  );
}

function localStorageGet(k: string) { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } }
function localStorageSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private window */ } }
