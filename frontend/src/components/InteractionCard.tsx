import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Interaction, type InteractionPayload } from '../api';
import { useAction } from '../lib/useAction';
import { Button, Notice, Pre, inputCls } from '../ui';

const KIND_LABEL: Record<string, string> = {
  question: 'questions', change: 'confirm a change', guard: 'approve a browser action', repair: 'approve a repair',
  setup: 'setup', proceed: 'decide how to go on', signoff: 'sign-off',
};

/** One open question, confirmation or approval, answered in place inside the conversation. */
export function InteractionCard({ item }: { item: Interaction }) {
  const qc = useQueryClient();
  const { busy, error, run } = useAction();
  const send = (response: unknown) => run(typeof response === 'string' ? response : 'answers', async () => {
    await api.post(`/api/interactions/${item.id}`, { response });
    qc.invalidateQueries();
  });
  const p = item.payload;
  const choice = (value: string, label: string, busyLabel: string, kind: 'primary' | 'danger' | 'default' = 'default') => (
    <Button kind={kind} busy={busy === value} disabled={!!busy} onClick={() => send(value)}>{busy === value ? busyLabel : label}</Button>
  );
  return (
    <div className="grid gap-3 p-1">
      <p className="text-sm font-medium">{item.title}: {KIND_LABEL[item.kind] ?? item.kind}</p>
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
          <div className="flex gap-2">{choice('approve', 'Approve', 'Approving…', 'primary')}{choice('refuse', 'Refuse', 'Refusing…', 'danger')}</div>
        </div>
      )}
      {item.kind === 'repair' && (
        <div className="grid gap-2 text-sm">
          <p>{p.summary}</p>
          <p className="text-xs text-muted">Playwright's healer would repair this test behind the assertion lock: it may not change what the test checks.</p>
          <div className="flex gap-2">{choice('approve', 'Approve repair', 'Approving…', 'primary')}{choice('decline', 'Decline', 'Declining…')}</div>
        </div>
      )}
      {(item.kind === 'setup' || item.kind === 'proceed') && (
        <div className="grid gap-2 text-sm">
          {(p.output || p.text) && <Pre className="max-h-72 overflow-y-auto">{p.output || p.text}</Pre>}
          <Options options={p.options} busy={busy} send={send} />
        </div>
      )}
      {item.kind === 'signoff' && <p className="text-sm">Record a decision for each unit and a result for each manual case in the Sign off step, then close the sign-off.</p>}
      {!(item.kind in KIND_LABEL) && <Options options={p.options} busy={busy} send={send} />}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}

function Options({ options = [], recommended, busy, send }: { options?: string[]; recommended?: string; busy: string | null; send: (r: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <Button key={o} kind={o === recommended ? 'primary' : 'default'} busy={busy === o} disabled={!!busy} onClick={() => send(o)}>
          {busy === o ? 'Sending…' : `${o}${o === recommended ? ' (suggested)' : ''}`}</Button>
      ))}
    </div>
  );
}

function Questions({ p, busy, send }: { p: InteractionPayload; busy: string | null; send: (r: unknown) => void }) {
  const qs = p.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(qs.map(q => [q.id, q.recommended ?? ''])));
  return (
    <form className="grid gap-3" onSubmit={e => { e.preventDefault(); send(answers); }}>
      {qs.map(q => (
        <div key={q.id} className="grid gap-1 text-sm">
          <label htmlFor={`q-${q.id}`}><b className="tnum">{q.id}.</b> {q.test_id && /\d/.test(q.test_id) ? <span className="font-mono text-xs text-muted">{q.test_id} · </span> : null}{q.text}</label>
          {q.recommended && <span className="text-xs text-muted">Recommended: {q.recommended}</span>}
          <input id={`q-${q.id}`} className={inputCls} disabled={!!busy} value={answers[q.id] ?? ''} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })} />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" kind="primary" busy={busy === 'answers'} disabled={!!busy}>{busy === 'answers' ? 'Sending…' : 'Send answers'}</Button>
        {p.can_defer && <Button busy={busy === '__defer__'} disabled={!!busy} onClick={() => send('__defer__')}>{busy === '__defer__' ? 'Writing…' : 'Author not available: write a questionnaire'}</Button>}
      </div>
    </form>
  );
}
