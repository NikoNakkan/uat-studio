import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Settings } from '../api';
import { ApiKeyBox } from '../components/ApiKey';
import { useSettings } from '../lib/queries';
import { useAction } from '../lib/useAction';
import { Button, Card, Empty, Field, Loading, MsgNotice, Notice, Pre, QueryGate, Table, errorText, inputCls, ok, useTitle, type Msg } from '../ui';

type Draft = Pick<Settings, 'models' | 'default_model' | 'max_turns' | 'max_output_tokens' | 'show_agent_browser'>;
type UsageTotals = { totals: { model: string; calls: number; input: number; output: number }[] };

const draftOf = (s: Settings): Draft => ({
  models: s.models, default_model: s.default_model, max_turns: s.max_turns, max_output_tokens: s.max_output_tokens, show_agent_browser: s.show_agent_browser,
});

/** The app's own settings: API key, model per agent and run limits, the kit's checks, token use across runs. */
export function SettingsPage() {
  useTitle('Settings');
  const s = useSettings();
  return (
    <div className="mx-auto grid max-w-5xl gap-5">
      <h1 className="text-xl font-semibold">Settings</h1>
      {s.isPending ? <Loading label="Loading settings…" />
        : s.isError || !s.data ? <Notice>{errorText(s.error ?? 'Settings could not be loaded.')}</Notice>
        : <>
            <Card title="Anthropic API key"><ApiKeyBox settings={s.data} /></Card>
            <ModelsCard settings={s.data} />
            <KitCard kitDir={s.data.kit_dir} />
            <UsageCard />
          </>}
    </div>
  );
}

/** Model per agent and run limits, edited as a local draft until saved (never written into the shared cache). */
function ModelsCard({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const { busy, error, run } = useAction();
  const form = draft ?? draftOf(settings);
  const edit = (patch: Partial<Draft>) => { setDraft({ ...form, ...patch }); setMsg(null); };
  const save = () => run('save', async () => {
    await api.put('/api/settings', form);
    setDraft(null);
    setMsg(ok('Saved.'));
    qc.invalidateQueries({ queryKey: ['settings'] });
  });
  return (
    <Card title="Model per agent" actions={<Button kind="primary" busy={!!busy} disabled={!draft || !!busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>}>
      <p className="mb-3 text-sm text-muted">Each agent's model is recorded with its token use in every run (decision 32). Cheaper models for simple jobs are future feature F15.</p>
      <Table head={['Agent', 'Job', 'Model']} rows={Object.entries(settings.agents).map(([agent, work]) => [
        <span className="font-mono text-xs">{agent}</span>, work,
        <select aria-label={`Model for ${agent}`} className={inputCls} value={form.models[agent] ?? form.default_model}
          onChange={e => edit({ models: { ...form.models, [agent]: e.target.value } })}>
          {settings.model_choices.map(m => <option key={m}>{m}</option>)}
        </select>,
      ])} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Most turns per agent conversation" hint="A run limit: an agent stops after this many model calls (F8).">
          <input type="number" min={5} max={300} className={inputCls} value={form.max_turns} onChange={e => edit({ max_turns: Number(e.target.value) })} />
        </Field>
        <Field label="Most output tokens per model call">
          <input type="number" min={1000} max={64000} className={inputCls} value={form.max_output_tokens} onChange={e => edit({ max_output_tokens: Number(e.target.value) })} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.show_agent_browser} onChange={e => edit({ show_agent_browser: e.target.checked })} />
          Show the browser while the AI works (planner, generator, healer, login setup). Saved test runs are always headless.
        </label>
      </div>
      <MsgNotice msg={error ? { text: error, ok: false } : msg} />
    </Card>
  );
}

/** The kit's own checks: the feature map and the self-test suite. */
function KitCard({ kitDir }: { kitDir: string }) {
  const [out, setOut] = useState('');
  const { busy, error, run } = useAction();
  const check = (name: string, url: string) => run(name, async () => {
    setOut('');
    const r = await api.post<{ output?: string }>(url);
    setOut(r.output ?? '');
  });
  return (
    <Card title="The kit" actions={<>
      <Button busy={busy === 'features'} disabled={!!busy} onClick={() => check('features', '/api/kit/features-check')}>{busy === 'features' ? 'Checking…' : 'Check the feature map'}</Button>
      <Button busy={busy === 'selftest'} disabled={!!busy} onClick={() => check('selftest', '/api/kit/selftest')}>{busy === 'selftest' ? 'Running self-tests…' : 'Run the kit self-tests'}</Button>
    </>}>
      <p className="text-sm text-muted">Kit folder: <span className="font-mono">{kitDir}</span>. The app runs the kit's own scripts for every deterministic step.</p>
      {busy && <div className="mt-3"><Loading label={busy === 'selftest' ? 'Running the kit self-tests…' : 'Checking the feature map…'} /></div>}
      {(out || error) && <Pre className={`mt-3 max-h-96 overflow-y-auto ${error ? 'text-bad' : ''}`}>{error || out}</Pre>}
    </Card>
  );
}

function UsageCard() {
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api.get<UsageTotals>('/api/usage') });
  return (
    <Card title="Token use across all runs">
      <QueryGate pending={usage.isPending} error={usage.isError ? usage.error : null} label="Loading token use…">
        {usage.data?.totals.length
          ? <Table head={['Model', 'Calls recorded', 'Input tokens', 'Output tokens']} rows={usage.data.totals.map(t => [
              t.model, <span className="tnum">{t.calls}</span>, <span className="tnum">{t.input.toLocaleString()}</span>, <span className="tnum">{t.output.toLocaleString()}</span>])} />
          : <Empty>No token use recorded yet.</Empty>}
      </QueryGate>
    </Card>
  );
}
