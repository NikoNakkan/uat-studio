import { useQueryClient } from '@tanstack/react-query';
import { api, type Interaction } from '../api';
import { refreshAfterAction } from '../lib/queries';
import { useAction } from '../lib/useAction';
import { Button, Notice, Pre } from '../ui';
import { Questions } from './interaction/Questions';

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
    refreshAfterAction(qc);
  });
  const p = item.payload;
  const choice = (value: string, label: string, busyLabel: string, kind: 'primary' | 'danger' | 'default' = 'default') => (
    <Button kind={kind} busy={busy === value} disabled={!!busy} onClick={() => send(value)}>{busy === value ? busyLabel : label}</Button>
  );
  return (
    <div className="grid gap-3 p-1">
      <p className="text-sm font-medium">{item.title}: {KIND_LABEL[item.kind] ?? item.kind}</p>
      {item.kind === 'question' && <Questions item={item} busy={busy} send={send} />}
      {item.kind === 'change' && (
        <div className="grid gap-2 text-sm">
          <p>Status: <b>{p.status}</b>{p.details?.fields_changed ? ` · fields: ${p.details.fields_changed.join(', ')}` : ''}
            {p.details?.similar_to ? ` · similar to ${p.details.similar_to}` : ''}</p>
          {p.details?.has_test && (p.status === 'new' || p.status === 'changed') && (
            <p className="rounded-md border border-line bg-surface-2/50 p-2">A test for this case already exists
              {p.details.last_result ? <> (last <b>{p.details.last_result.result}</b> in run {p.details.last_result.run})</> : null}.
              Reuse keeps it as it is; writing it again replaces it.</p>
          )}
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
