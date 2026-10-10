import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, MsgNotice, fail, inputCls, ok, type Msg } from '../ui';

/**
 * The Anthropic API key. Once saved it is shown as saved (its last characters only), with Test, Replace and
 * Remove; the empty input only appears when there is no key or the person chooses to replace it.
 */
export function ApiKeyBox({ settings }: { settings: any }) {
  const qc = useQueryClient();
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const isSet = !!settings?.api_key_set;
  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setMsg(null);
    try { await fn(); } catch (e) { setMsg(fail(e)); } finally { setBusy(null); }
  };
  const save = () => act('save', async () => {
    await api.put('/api/settings', { api_key: key.trim() });
    setKey(''); setReplacing(false); setMsg(ok('Key saved.'));
    qc.invalidateQueries({ queryKey: ['settings'] });
  });
  return (
    <div className="grid gap-3">
      {isSet && !replacing ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-good/50 bg-good/5 px-3 py-2.5">
          <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-good text-xs text-white">✓</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Key saved</div>
            <div className="font-mono text-xs text-muted">sk-ant-••••••••••••{String(settings.api_key_hint ?? '').replace('…', '')}
              {settings.api_key_from_env ? ' · from the ANTHROPIC_API_KEY environment variable' : ''}</div>
          </div>
          <Button busy={busy === 'test'} disabled={!!busy} onClick={() => act('test', async () => {
            const r = await api.post<{ ok: boolean; model?: string }>('/api/settings/test');
            setMsg(r.ok ? ok(`The key works (${r.model}).`) : { text: 'The key was refused.', ok: false });
          })}>{busy === 'test' ? 'Testing…' : 'Test the key'}</Button>
          {!settings.api_key_from_env && <>
            <Button disabled={!!busy} onClick={() => { setReplacing(true); setMsg(null); }}>Replace</Button>
            <Button kind="danger" busy={busy === 'clear'} disabled={!!busy} onClick={() => act('clear', async () => {
              await api.put('/api/settings', { clear_api_key: true }); setMsg(ok('Key removed.'));
              qc.invalidateQueries({ queryKey: ['settings'] });
            })}>{busy === 'clear' ? 'Removing…' : 'Remove'}</Button>
          </>}
        </div>
      ) : (
        <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (key.trim()) save(); }}>
          <input type="password" autoComplete="off" aria-label="API key" autoFocus={replacing} className={`${inputCls} max-w-md`}
            placeholder={replacing ? 'Paste the new key' : 'Paste your key: sk-ant-…'} value={key} onChange={e => setKey(e.target.value)} />
          <Button type="submit" kind="primary" busy={busy === 'save'} disabled={!key.trim() || !!busy}>{busy === 'save' ? 'Saving…' : 'Save key'}</Button>
          {replacing && <Button disabled={!!busy} onClick={() => { setReplacing(false); setKey(''); }}>Cancel</Button>}
        </form>
      )}
      <MsgNotice msg={msg} className="" />
      <p className="text-xs text-muted">From console.anthropic.com → API Keys. Stored in ~/.uat-studio/settings.json on this machine, never in a
        repository, and never shown again: only its last characters.</p>
    </div>
  );
}
