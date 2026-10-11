import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ListEditor } from '../components/guardrails/ListEditor';
import { useAction } from '../lib/useAction';
import { Button, Card, MsgNotice, QueryGate, ok, useTitle, type Msg } from '../ui';

export type GuardrailSettings = {
  allowed_origins: string[]; blocked_tools: string[]; protected_files: string[];
  never_click: string[]; ask_before_click_matching: string[]; dialogs_need_approval: boolean;
};
type GuardrailsData = { settings: GuardrailSettings; known_tools: Record<string, string>; always_protected: string };

/** What the agents may never do, as settings. The kit's guard checks them before every tool call. */
export function GuardrailsPage() {
  useTitle('Guardrails');
  const q = useQuery({ queryKey: ['guardrails'], queryFn: () => api.get<GuardrailsData>('/api/guardrails') });
  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <div>
        <h1 className="text-xl font-semibold">Guardrails</h1>
        <p className="text-sm text-muted">What the agents may never do while they test this app. Checked before every action an agent takes; a change applies to the next one.</p>
      </div>
      <QueryGate pending={q.isPending} error={q.isError ? q.error : null} label="Loading the guardrails…">
        {q.data && <GuardrailsForm data={q.data} />}
      </QueryGate>
    </div>
  );
}

function GuardrailsForm({ data }: { data: GuardrailsData }) {
  const qc = useQueryClient();
  const [g, setG] = useState(data.settings);
  const [msg, setMsg] = useState<Msg>(null);
  const { busy, error, run } = useAction();
  const set = <K extends keyof GuardrailSettings>(key: K) => (value: GuardrailSettings[K]) => { setG(s => ({ ...s, [key]: value })); setMsg(null); };
  const changed = JSON.stringify(g) !== JSON.stringify(data.settings);
  const save = () => run('save', async () => {
    setG(await api.put<GuardrailSettings>('/api/guardrails', g));      // as saved: trimmed, .env kept
    await qc.invalidateQueries({ queryKey: ['guardrails'] });
    await qc.invalidateQueries({ queryKey: ['env'] });
    setMsg(ok('Saved. The next agent action is checked against these rules.'));
  });
  const custom = g.blocked_tools.filter(t => !(t in data.known_tools));
  const toggleTool = (tool: string, on: boolean) => set('blocked_tools')(on ? [...g.blocked_tools, tool] : g.blocked_tools.filter(t => t !== tool));
  const actions = (
    <div className="flex flex-wrap items-center gap-3">
      <Button kind="primary" busy={busy === 'save'} disabled={!changed || !!busy} onClick={save}>{busy ? 'Saving…' : 'Save guardrails'}</Button>
      {changed && <><Button disabled={!!busy} onClick={() => setG(data.settings)}>Undo changes</Button>
        <span className="text-sm text-warn">Not saved yet</span></>}
      <MsgNotice msg={error ? { text: error, ok: false } : msg} className="" />
    </div>
  );
  return (
    <div className="grid gap-4">
      {actions}
      <Card title="Browser">
        <div className="grid gap-5">
          <ListEditor label="Sites the browser may open" mono items={g.allowed_origins} onChange={set('allowed_origins')}
            placeholder="https://test.app.example.com" hint="Scheme and host only. Every other site is refused. * stands for one or more name parts, e.g. https://*.crm.dynamics.com." />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={g.dialogs_need_approval} onChange={e => set('dialogs_need_approval')(e.target.checked)} />
            <span><span className="font-medium">Ask me before accepting a browser dialog</span>
              <span className="block text-xs text-muted">Such as "Delete this taxi?". When off, the agent may accept it.</span></span>
          </label>
        </div>
      </Card>
      <Card title="Clicks">
        <div className="grid gap-5">
          <ListEditor label="Ask me before clicking anything with these words" items={g.ask_before_click_matching} onChange={set('ask_before_click_matching')}
            placeholder="delete" hint='A whole word in the button or link name, any case: "delete" asks for "Delete Taxi", not for "Undeleted".' />
          <ListEditor label="Never click" items={g.never_click} onChange={set('never_click')}
            placeholder="Clear all" hint="Exact button or link names, any case. Refused outright, never asked." />
        </div>
      </Card>
      <Card title="Agent tools and files">
        <div className="grid gap-5">
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Tools the agents may not use</legend>
            {Object.entries(data.known_tools).map(([tool, what]) => (
              <label key={tool} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={g.blocked_tools.includes(tool)} onChange={e => toggleTool(tool, e.target.checked)} />
                <span><span className="font-mono">{tool}</span><span className="block text-xs text-muted">{what}</span></span>
              </label>
            ))}
            <ListEditor label="Other tools to block" mono items={custom} placeholder="browser_tool_name"
              onChange={items => set('blocked_tools')([...g.blocked_tools.filter(t => t in data.known_tools), ...items])}
              hint="Any other tool name an agent has, as it appears in the live panel." />
          </fieldset>
          <ListEditor label="Files no agent may open" mono items={g.protected_files} onChange={set('protected_files')} placeholder="secrets/keys.txt"
            locked={{ [data.always_protected]: 'The passwords of the test accounts: tests read it, agents never do.' }}
            hint="Paths inside the project. Refused with any file tool or command." />
        </div>
      </Card>
      {actions}
    </div>
  );
}
