import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, errorText } from '../ui';

/**
 * Stop and Delete for one run, wherever the run is shown. Delete asks first, in place; a signed-off run
 * (sealed evidence) asks a second, explicit time. The generated tests stay: later runs reuse them.
 */
export function RunActions({ runId, running, sealed, onDeleted, size = 'normal' }: {
  runId: string; running: boolean; sealed: boolean; onDeleted?: () => void; size?: 'normal' | 'small';
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what); setError('');
    try { await fn(); qc.invalidateQueries(); } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const del = () => act('delete', async () => {
    await api.del(`/api/runs/${runId}${sealed ? '?signed_off=true' : ''}`);
    setConfirm(false);
    onDeleted?.();
  });
  const small = size === 'small';
  return (
    <div className={`flex flex-wrap items-center gap-2 ${small ? 'text-xs' : ''}`}>
      {running && !confirm && (
        <Button kind="danger" busy={busy === 'stop'} disabled={!!busy} onClick={() => act('stop', () => api.post(`/api/runs/${runId}/stop`))}>
          {busy === 'stop' ? 'Stopping…' : 'Stop'}</Button>
      )}
      {!confirm
        ? <Button kind="ghost" disabled={!!busy} onClick={() => { setConfirm(true); setError(''); }}>Delete</Button>
        : (
          <span role="alertdialog" aria-label={`Delete ${runId}`} className="flex flex-wrap items-center gap-2 rounded-md border border-bad/50 bg-bad/5 px-2 py-1 text-sm">
            <span>{sealed
              ? <><b>Signed off.</b> Delete its sealed evidence and record for good?</>
              : <>Delete {running ? 'and stop ' : ''}this run and its evidence? Tests stay.</>}</span>
            <Button kind="danger" busy={busy === 'delete'} disabled={!!busy} onClick={del}>{busy === 'delete' ? 'Deleting…' : 'Yes, delete'}</Button>
            <Button disabled={!!busy} onClick={() => setConfirm(false)}>Cancel</Button>
          </span>
        )}
      {error && <span className="text-sm text-bad">{error}</span>}
    </div>
  );
}
