import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Interaction } from '../api';
import { Button, Pre, errorText, inputCls } from '../ui';

/** The flow's stops for a person: every open question, confirmation and approval, answered here. */
export function NeedsYou({ items, onSignoff }: { items: Interaction[]; onSignoff?: () => void }) {
  if (!items.length) return null;
  return (
    <section aria-label="Needs you" className="rounded-lg border-2 border-warn/60 bg-surface">
      <header className="border-b border-line px-4 py-2.5 text-sm font-semibold text-warn">Needs you · {items.length}</header>
      <div className="divide-y divide-line">{items.map(i => <InteractionCard key={i.id} item={i} onSignoff={onSignoff} />)}</div>
    </section>
  );
}

function InteractionCard({ item, onSignoff }: { item: Interaction; onSignoff?: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (response: unknown) => {
    setBusy(true); setError('');
    try {
      await api.post(`/api/interactions/${item.id}`, { response });
      qc.invalidateQueries();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const p = item.payload ?? {};
  return (
    <div className="p-4 grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{item.title}</h3>
        <span className="text-xs text-muted">{kindLabel(item.kind)}{p.agent ? ` · ${p.agent}` : ''}</span>
      </div>
      {item.kind === 'question' && <Questions p={p} busy={busy} send={send} />}
      {item.kind === 'change' && (
        <div className="grid gap-2 text-sm">
          <p>Status: <b>{p.status}</b>{p.details?.fields_changed ? ` · fields: ${p.details.fields_changed.join(', ')}` : ''}
            {p.details?.similar_to ? ` · similar to ${p.details.similar_to}` : ''}</p>
          {p.explanation && <p className="text-muted">{p.explanation}</p>}
          <Options options={p.options} recommended={p.suggestion} busy={busy} send={send} />
        </div>
      )}
      {item.kind === 'guard' && (
        <div className="grid gap-2 text-sm">
          <p>{p.reason}</p>
          <Pre>{p.tool}{'\n'}{JSON.stringify(p.input, null, 2)}</Pre>
          <div className="flex gap-2"><Button kind="primary" disabled={busy} onClick={() => send('approve')}>Approve</Button>
            <Button kind="danger" disabled={busy} onClick={() => send('refuse')}>Refuse</Button></div>
        </div>
      )}
      {item.kind === 'repair' && (
        <div className="grid gap-2 text-sm">
          <p>{p.summary}</p>
          <p className="text-xs text-muted">Playwright's healer would repair this test behind the assertion lock: it may not change what the test checks.</p>
          <div className="flex gap-2"><Button kind="primary" disabled={busy} onClick={() => send('approve')}>Approve repair</Button>
            <Button disabled={busy} onClick={() => send('decline')}>Decline</Button></div>
        </div>
      )}
      {(item.kind === 'setup' || item.kind === 'proceed') && (
        <div className="grid gap-2 text-sm">
          {(p.output || p.text) && <Pre className="max-h-72 overflow-y-auto">{p.output || p.text}</Pre>}
          <Options options={p.options} busy={busy} send={send} />
        </div>
      )}
      {item.kind === 'signoff' && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p>Record a decision for each unit and a result for each manual case, then close the sign-off.</p>
          {onSignoff && <Button kind="primary" onClick={onSignoff}>Open sign-off</Button>}
        </div>
      )}
      {!['question', 'change', 'guard', 'repair', 'setup', 'proceed', 'signoff'].includes(item.kind) && p.options &&
        <Options options={p.options} busy={busy} send={send} />}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

function kindLabel(kind: string) {
  return ({ question: 'Questions', change: 'Confirm a change', guard: 'Approve a browser action', repair: 'Approve a repair',
    setup: 'Setup', proceed: 'Decide how to go on', signoff: 'Sign-off' } as Record<string, string>)[kind] ?? kind;
}

function Options({ options, recommended, busy, send }: { options: string[]; recommended?: string; busy: boolean; send: (r: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(options ?? []).map(o => <Button key={o} kind={o === recommended ? 'primary' : 'default'} disabled={busy} onClick={() => send(o)}>
        {o}{o === recommended ? ' (suggested)' : ''}</Button>)}
    </div>
  );
}

function Questions({ p, busy, send }: { p: any; busy: boolean; send: (r: unknown) => void }) {
  const qs: { id: string; test_id?: string; text: string; recommended?: string }[] = p.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(qs.map(q => [q.id, q.recommended ?? ''])));
  return (
    <form className="grid gap-3" onSubmit={e => { e.preventDefault(); send(answers); }}>
      {qs.map(q => (
        <div key={q.id} className="grid gap-1 text-sm">
          <label htmlFor={`q-${q.id}`}><b className="tnum">{q.id}.</b> {q.test_id ? <span className="font-mono text-xs text-muted">{q.test_id} · </span> : null}{q.text}</label>
          {q.recommended && <span className="text-xs text-muted">Recommended: {q.recommended}</span>}
          <input id={`q-${q.id}`} className={inputCls} value={answers[q.id] ?? ''} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })} />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" kind="primary" disabled={busy}>Send answers</Button>
        {p.can_defer && <Button disabled={busy} onClick={() => send('__defer__')}>Author not available: write a questionnaire</Button>}
      </div>
    </form>
  );
}
