import { useState } from 'react';
import { Link } from 'react-router';
import { api, type EnvInfo } from '../../api';
import { useAction } from '../../lib/useAction';
import { Button, Field, MsgNotice, inputCls, ok, type Msg } from '../../ui';

/** The start page (kept by Studio, handed to the tests) and the only sites the browser may open (config/guardrails.yaml). */
export function AppUnderTest({ env, onSaved }: { env: EnvInfo; onSaved: () => void }) {
  const [start, setStart] = useState<string | null>(null);
  const [origins, setOrigins] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const { busy, error, run } = useAction();
  const save = () => run('save', async () => {
    setMsg(null);
    if (start !== null) await api.put('/api/env', { key: 'START_PAGE', value: start });
    if (origins !== null) await api.put('/api/guardrails/origins', { origins: origins.split(/[\s,]+/).filter(Boolean) });
    setMsg(ok('Saved.'));
    onSaved();
  });
  return (
    <div className="grid gap-3">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Start page" hint="Where every test starts. Filled in from the Excel's Start page column when you start a run.">
          <input className={inputCls} value={start ?? env.start_page} onChange={e => setStart(e.target.value)} placeholder="https://test.app.example.com" />
        </Field>
        <Field label="Allowed sites" hint="The only sites the browser may open. One per line, scheme and host only. The other guardrails are on their own page.">
          <textarea className={`${inputCls} font-mono`} rows={3} value={origins ?? env.allowed_origins.join('\n')} onChange={e => setOrigins(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="primary" busy={!!busy} disabled={start === null && origins === null} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        <Link to="/guardrails" className="text-sm text-link hover:underline">All guardrails →</Link>
      </div>
      <MsgNotice msg={error ? { text: error, ok: false } : msg} className="" />
    </div>
  );
}
