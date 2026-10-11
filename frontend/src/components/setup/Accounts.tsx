import { useState } from 'react';
import { api, type Account, type EnvInfo } from '../../api';
import { useAction } from '../../lib/useAction';
import { Button, Field, MsgNotice, inputCls, ok, type Msg } from '../../ui';

/** One line per account for the step's summary: who it is and the saved user, or that it is not saved. */
export function accountSummary(a: Account): string {
  const label = a.label || a.name;
  return a.user_set && a.password_set ? `${label} · ${a.user}` : `${label} (not saved)`;
}

function usedLine(ids: string[]): string {
  if (!ids.length) return '';
  return ids.length <= 3 ? `Named in ${ids.join(', ')}` : `Named in ${ids.length} test cases`;
}

/** The people the tests log in as: each saved once (user shown, password never), plus adding a new one. */
export function Accounts({ env, onSaved }: { env: EnvInfo; onSaved: () => void }) {
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const { busy, error, run } = useAction();
  const add = () => run('add', async () => {
    setMsg(null);
    const r = await api.post<{ label: string; created: boolean }>('/api/env/accounts', { label: label.trim() });
    setLabel('');
    setMsg(ok(r.created ? `${r.label} added. Enter their user and password.` : `${r.label} is already on the list.`));
    onSaved();
  });
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">Each row is a person the tests log in as. The Excel names them in plain words, such as Employee test account.
        Saving keeps the user on screen. The password stays on this machine and is not shown again.</p>
      {env.accounts.length === 0 && <p className="text-sm text-muted">No people yet. Add one, then enter how they sign in.</p>}
      {env.accounts.map(a => <AccountCard key={a.name} account={a} onSaved={onSaved} />)}
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (label.trim()) add(); }}>
        <input className={`${inputCls} max-w-xs`} placeholder="New person, e.g. Employee test account" aria-label="New person"
          value={label} disabled={!!busy} onChange={e => setLabel(e.target.value)} />
        <Button type="submit" busy={!!busy} disabled={!label.trim()}>{busy ? 'Adding…' : 'Add person'}</Button>
      </form>
      <MsgNotice msg={error ? { text: error, ok: false } : msg} className="" />
    </div>
  );
}

function AccountCard({ account, onSaved }: { account: Account; onSaved: () => void }) {
  const ready = account.user_set && account.password_set;
  const label = account.label || account.name;
  const [editing, setEditing] = useState(false);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [held, setHeld] = useState<string | null>(null);   // the user just saved, shown before the list refreshes
  const [cleared, setCleared] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const { busy, error, run } = useAction();
  const named = usedLine(account.used_by ?? []);
  const shown: Msg = error ? { text: error, ok: false } : msg;

  const save = () => run('save', async () => {
    setMsg(null);
    await api.put(`/api/env/accounts/${account.name}`, { user: user.trim(), password });
    setHeld(user.trim()); setCleared(false); setPassword(''); setEditing(false);
    setMsg(ok(`${label} saved.`));
    onSaved();
  });
  const clear = () => run('clear', async () => {
    setMsg(null);
    await api.del(`/api/env/accounts/${account.name}`);
    setUser(''); setPassword(''); setHeld(null); setCleared(true);
    setMsg(ok(`${label} removed. The name stays, so you can save them again.`));
    onSaved();
  });

  if (!editing && !cleared && (ready || held !== null)) {
    return (
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-good/50 bg-good/5 px-3 py-2.5">
          <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-good text-xs text-white">✓</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{label}</div>
            <div className="truncate text-sm text-muted">{ready ? account.user : held}</div>
            <div className="text-xs text-muted">Password saved{named ? ` · ${named}` : ''}</div>
          </div>
          <Button disabled={!!busy} onClick={() => { setEditing(true); setUser(account.user || ''); setPassword(''); setMsg(null); }}>Change</Button>
          <Button kind="danger" busy={busy === 'clear'} disabled={!!busy} onClick={clear}>{busy === 'clear' ? 'Removing…' : 'Remove'}</Button>
        </div>
        <MsgNotice msg={shown} className="" />
      </div>
    );
  }
  return (
    <form className="grid gap-3 rounded-md border border-line px-3 py-3" onSubmit={e => { e.preventDefault(); if (user.trim()) save(); }}>
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs text-muted">{editing ? 'A blank password keeps the one already saved.'
          : 'Not saved yet. Tests cannot log in as this person until you save a user and a password.'}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="User">
          <input className={inputCls} autoComplete="off" value={user} disabled={!!busy} placeholder="name@company.test" onChange={e => setUser(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" className={inputCls} autoComplete="new-password" value={password} disabled={!!busy}
            placeholder={account.password_set ? 'Saved — type to replace' : 'Password'} onChange={e => setPassword(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" kind="primary" busy={busy === 'save'} disabled={!user.trim() || !!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
        {editing && <Button disabled={!!busy} onClick={() => { setEditing(false); setUser(''); setPassword(''); setMsg(null); }}>Cancel</Button>}
      </div>
      <MsgNotice msg={shown} className="" />
    </form>
  );
}
