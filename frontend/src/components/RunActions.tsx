import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { refreshAfterAction } from '../lib/queries';
import { useAction } from '../lib/useAction';
import { Button } from '../ui';

type Confirm = null | 'delete' | 'redo';

/**
 * Stop, Delete and (on the run page) Redo sign-off for one run, wherever the run is shown. Delete and Redo
 * ask first, in place; deleting a signed-off run (sealed evidence) says so. The generated tests stay: later
 * runs reuse them. Redo keeps the old sign-off in the run's earlier-signoffs folder.
 */
export function RunActions({ runId, running, sealed, onDeleted, size = 'normal' }: {
  runId: string; running: boolean; sealed: boolean; onDeleted?: () => void; size?: 'normal' | 'small';
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const { busy, error, setError, run } = useAction();
  const act = (what: string, fn: () => Promise<unknown>) => run(what, async () => { await fn(); refreshAfterAction(qc); });
  const del = () => act('delete', async () => {
    await api.del(`/api/runs/${runId}${sealed ? '?signed_off=true' : ''}`);
    setConfirm(null);
    onDeleted?.();
  });
  const redo = () => act('redo', async () => { await api.post(`/api/runs/${runId}/signoff/redo`); setConfirm(null); });
  const ask = (what: Confirm) => { setConfirm(what); setError(''); };
  const small = size === 'small';
  return (
    <div className={`flex flex-wrap items-center gap-2 ${small ? 'text-xs' : ''}`}>
      {running && !confirm && (
        <Button kind="danger" busy={busy === 'stop'} disabled={!!busy} onClick={() => act('stop', () => api.post(`/api/runs/${runId}/stop`))}>
          {busy === 'stop' ? 'Stopping…' : 'Stop'}</Button>
      )}
      {!confirm && sealed && !running && !small && (
        <Button disabled={!!busy} onClick={() => ask('redo')} title="Clear every decision and manual result and sign off again">Redo sign-off</Button>
      )}
      {!confirm && <Button kind="ghost" disabled={!!busy} onClick={() => ask('delete')}>Delete</Button>}
      {confirm === 'redo' && (
        <ConfirmBar label={`Redo the sign-off of ${runId}`} onCancel={() => setConfirm(null)} busy={!!busy}
          question={<>Clear every decision and manual result and sign off again? The old sign-off is kept in the run.</>}
          action={<Button kind="primary" busy={busy === 'redo'} disabled={!!busy} onClick={redo}>{busy === 'redo' ? 'Resetting…' : 'Yes, redo sign-off'}</Button>} />
      )}
      {confirm === 'delete' && (
        <ConfirmBar label={`Delete ${runId}`} onCancel={() => setConfirm(null)} busy={!!busy} danger
          question={sealed
            ? <><b>Signed off.</b> Delete its sealed evidence and record for good?</>
            : <>Delete {running ? 'and stop ' : ''}this run and its evidence? Tests stay.</>}
          action={<Button kind="danger" busy={busy === 'delete'} disabled={!!busy} onClick={del}>{busy === 'delete' ? 'Deleting…' : 'Yes, delete'}</Button>} />
      )}
      {error && <span className="text-sm text-bad">{error}</span>}
    </div>
  );
}

function ConfirmBar({ label, question, action, onCancel, busy, danger = false }: {
  label: string; question: ReactNode; action: ReactNode; onCancel: () => void; busy: boolean; danger?: boolean;
}) {
  return (
    <span role="alertdialog" aria-label={label}
      className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-sm ${danger ? 'border-bad/50 bg-bad/5' : 'border-accent/60 bg-accent/5'}`}>
      <span>{question}</span>
      {action}
      <Button disabled={busy} onClick={onCancel}>Cancel</Button>
    </span>
  );
}
