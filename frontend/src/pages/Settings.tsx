import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, Card, Field, Pre, Table, errorText, inputCls } from '../ui';

export function SettingsPage() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api.get<any>('/api/settings') });
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api.get<any>('/api/usage') });
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (body: unknown, note = 'Saved.') => {
    setMsg('');
    try { await api.put('/api/settings', body); setMsg(note); qc.invalidateQueries({ queryKey: ['settings'] }); } catch (e) { setMsg(errorText(e)); }
  };
  const run = async (url: string) => {
    setBusy(true); setOut('');
    try { const r = await api.post<any>(url); setOut(r.output ?? `${r.answer} (${r.model})`); } catch (e) { setOut(errorText(e)); } finally { setBusy(false); }
  };
  const d = s.data;
  if (!d) return null;
  return (
    <div className="mx-auto grid max-w-5xl gap-5">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card title="Anthropic API key">
        <p className="mb-3 text-sm text-muted">The agents run on your key. It is stored in {`~/.uat-studio/settings.json`} on this machine, never in a repository, and never shown again.
          {d.api_key_from_env ? ' The key currently comes from the ANTHROPIC_API_KEY environment variable.' : ''}</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={d.api_key_set ? `Key set (${d.api_key_hint})` : 'No key set'}>
            <input type="password" autoComplete="off" className={`${inputCls} w-80`} placeholder="sk-ant-…" value={key} onChange={e => setKey(e.target.value)} />
          </Field>
          <Button kind="primary" disabled={!key} onClick={() => { save({ api_key: key }, 'Key saved.'); setKey(''); }}>Save key</Button>
          <Button disabled={!d.api_key_set || busy} onClick={() => run('/api/settings/test')}>Test the key</Button>
          {d.api_key_set && !d.api_key_from_env && <Button kind="danger" onClick={() => save({ clear_api_key: true }, 'Key removed.')}>Remove</Button>}
        </div>
        {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      </Card>

      <Card title="Model per agent" actions={<Button kind="primary" onClick={() => save({ models: d.models, default_model: d.default_model, max_turns: d.max_turns, max_output_tokens: d.max_output_tokens, show_agent_browser: d.show_agent_browser })}>Save</Button>}>
        <p className="mb-3 text-sm text-muted">Each agent's model is recorded with its token use in every run (decision 32). Cheaper models for simple jobs are future feature F15.</p>
        <Table head={['Agent', 'Job', 'Model']} rows={Object.entries(d.agents as Record<string, string>).map(([agent, job]) => [
          <span className="font-mono text-xs">{agent}</span>, job,
          <select aria-label={`Model for ${agent}`} className={inputCls} value={d.models[agent]} onChange={e => qc.setQueryData(['settings'], { ...d, models: { ...d.models, [agent]: e.target.value } })}>
            {d.model_choices.map((m: string) => <option key={m}>{m}</option>)}
          </select>,
        ])} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Most turns per agent conversation" hint="A run limit: an agent stops after this many model calls (F8).">
            <input type="number" min={5} max={300} className={inputCls} value={d.max_turns} onChange={e => qc.setQueryData(['settings'], { ...d, max_turns: Number(e.target.value) })} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={d.show_agent_browser} onChange={e => qc.setQueryData(['settings'], { ...d, show_agent_browser: e.target.checked })} />
            Show the browser while the AI works (planner, generator, healer, login setup). Saved test runs are always headless.
          </label>
          <Field label="Most output tokens per model call">
            <input type="number" min={1000} max={64000} className={inputCls} value={d.max_output_tokens} onChange={e => qc.setQueryData(['settings'], { ...d, max_output_tokens: Number(e.target.value) })} />
          </Field>
        </div>
      </Card>

      <Card title="The kit" actions={<>
        <Button disabled={busy} onClick={() => run('/api/kit/features-check')}>Check the feature map</Button>
        <Button disabled={busy} onClick={() => run('/api/kit/selftest')}>Run the kit self-tests</Button>
      </>}>
        <p className="text-sm text-muted">Kit folder: <span className="font-mono">{d.kit_dir}</span>. The app runs the kit's own scripts for every deterministic step.</p>
        {busy && <p className="mt-2 text-sm text-muted">Running…</p>}
        {out && <Pre className="mt-3 max-h-96 overflow-y-auto">{out}</Pre>}
      </Card>

      <Card title="Token use across all runs">
        <Table head={['Model', 'Calls recorded', 'Input tokens', 'Output tokens']} rows={(usage.data?.totals ?? []).map((t: any) => [
          t.model, <span className="tnum">{t.calls}</span>, <span className="tnum">{t.input.toLocaleString()}</span>, <span className="tnum">{t.output.toLocaleString()}</span>])} />
      </Card>
    </div>
  );
}
