import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useAction } from '../lib/useAction';
import { Button, Card, MsgNotice, QueryGate, inputCls, ok, type Msg } from '../ui';

/**
 * A text file of the kit, edited in place: loaded from `url` (GET), saved back to it (PUT { text }). The draft is
 * local until saved; give the component a `key` per file so switching files starts a fresh draft.
 */
export function TextFileEditor({ url, title, intro, rows = 20, small = false, savedNote = 'Saved.' }: {
  url: string; title: string; intro?: ReactNode; rows?: number; small?: boolean; savedNote?: string;
}) {
  const qc = useQueryClient();
  const file = useQuery({ queryKey: ['kit-file', url], queryFn: () => api.get<{ text: string }>(url) });
  const [draft, setDraft] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const { busy, error, run } = useAction();
  const save = () => run('save', async () => {
    if (draft === null) return;
    setMsg(null);
    await api.put(url, { text: draft });
    setDraft(null);
    setMsg(ok(savedNote));
    await qc.invalidateQueries({ queryKey: ['kit-file', url] });
  });
  return (
    <Card title={title} actions={<Button kind="primary" busy={!!busy} disabled={draft === null || file.isPending || !!busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>}>
      {intro && <p className="mb-2 text-sm text-muted">{intro}</p>}
      <QueryGate pending={file.isPending} error={file.isError ? file.error : null} label={`Loading ${title}…`}>
        <textarea aria-label={title} className={`${inputCls} font-mono ${small ? 'text-xs' : ''}`} rows={rows} disabled={!!busy}
          value={draft ?? file.data?.text ?? ''} onChange={e => { setDraft(e.target.value); setMsg(null); }} />
        {draft !== null && <p className="mt-2 text-xs text-warn">Unsaved changes</p>}
        <MsgNotice msg={error ? { text: error, ok: false } : msg} />
      </QueryGate>
    </Card>
  );
}
