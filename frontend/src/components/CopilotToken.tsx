import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Settings } from '../api';
import { useAction } from '../lib/useAction';
import { Button, Notice, inputCls } from '../ui';

const NEW_TOKEN = 'https://github.com/settings/personal-access-tokens/new';

/**
 * How Studio signs in to Copilot: a GitHub token saved here (it stays on this machine and is never shown again),
 * or else the GitHub CLI's sign-in on this computer. Works for personal plans and for company (Business or
 * Enterprise) seats.
 */
export function CopilotToken({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const [token, setToken] = useState('');
  const { busy, error, run } = useAction();
  const save = (body: object) => run('save', async () => {
    await api.put('/api/settings', body);
    setToken('');
    await qc.invalidateQueries({ queryKey: ['settings'] });
    await qc.invalidateQueries({ queryKey: ['copilot'] });
  });
  return (
    <div className="grid gap-3 text-sm">
      <div className="grid gap-1">
        <span className="font-medium">GitHub token</span>
        {settings.github_token_set
          ? <p>Saved (ends <span className="font-mono">{settings.github_token_hint}</span>){settings.github_token_from_env ? ', from COPILOT_GITHUB_TOKEN on this machine' : ''}. Copilot signs in with it.</p>
          : <p className="text-muted">None: Copilot uses the GitHub CLI's sign-in on this computer, if there is one.</p>}
        {!settings.github_token_from_env && (
          <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (token.trim()) save({ github_token: token }); }}>
            <input type="password" autoComplete="off" className={`${inputCls} max-w-md font-mono`} placeholder="github_pat_…"
              aria-label="GitHub token" value={token} onChange={e => setToken(e.target.value)} />
            <Button type="submit" kind="primary" busy={busy === 'save'} disabled={!token.trim() || !!busy}>{busy ? 'Saving…' : 'Save token'}</Button>
            {settings.github_token_set && <Button disabled={!!busy} onClick={() => save({ clear_github_token: true })}>Remove</Button>}
          </form>
        )}
        {error && <Notice>{error}</Notice>}
      </div>
      <details className="rounded-md border border-line p-2">
        <summary className="cursor-pointer font-medium">How to make the token</summary>
        <ol className="mt-2 grid list-decimal gap-1 pl-5">
          <li>Open <a className="text-link hover:underline" href={NEW_TOKEN} target="_blank" rel="noreferrer">GitHub: new fine-grained token</a>, signed in with the account that has Copilot.</li>
          <li>Resource owner: <b>your own account</b>, not your company's organisation (the permission only exists there).</li>
          <li>Permissions → <b>Account</b> tab → Add permissions → <b>Copilot Requests</b>. Nothing else is needed.</li>
          <li>Generate it and paste it here. It starts with <span className="font-mono">github_pat_</span>; classic tokens (<span className="font-mono">ghp_</span>) do not work with Copilot.</li>
        </ol>
      </details>
      <details className="rounded-md border border-line p-2">
        <summary className="cursor-pointer font-medium">Company accounts (Copilot Business or Enterprise)</summary>
        <ul className="mt-2 grid list-disc gap-1 pl-5">
          <li>Your company must have given your account a Copilot seat.</li>
          <li>Your administrator must allow <b>Copilot CLI</b> in the organisation's Copilot policies; Studio runs through it. If it is off, the test says "Access denied by policy settings".</li>
          <li>If your company uses single sign-on and GitHub asks, authorise the token for the organisation.</li>
          <li>If your company's GitHub has its own address (<span className="font-mono">something.ghe.com</span>), leave the token empty and sign in with the GitHub CLI on that address: <code className="rounded bg-surface-2 px-1">gh auth login --hostname something.ghe.com</code></li>
          <li>On managed machines the token can also come from the <span className="font-mono">COPILOT_GITHUB_TOKEN</span> environment variable.</li>
        </ul>
      </details>
    </div>
  );
}
