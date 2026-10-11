import type { AgentInfo, ModelChoice } from '../api';
import { Button, Pill, Table, inputCls } from '../ui';

/** The models a person can choose from, with price and what each is good at. */
export function ModelGuide({ choices }: { choices: ModelChoice[] }) {
  return (
    <ul className="mb-4 grid gap-2 sm:grid-cols-2">
      {choices.map(m => (
        <li key={m.id} className="rounded-md border border-line px-3 py-2 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{m.name}</span>
            <span className="tnum text-xs text-muted" title="US dollars per million input / output tokens">{m.price}</span>
          </div>
          <p className="text-xs text-muted">{m.use}</p>
        </li>
      ))}
    </ul>
  );
}

/** One row per agent: its job, the chosen model, and why the recommended model fits; one click goes back to it. */
export function AgentModels({ agents, choices, models, onChange }: {
  agents: Record<string, AgentInfo>;
  choices: ModelChoice[];
  models: Record<string, string>;
  onChange: (models: Record<string, string>) => void;
}) {
  // Short names ("Opus 5.5") so the "(recommended)" mark fits in the closed list.
  const nameOf = (id: string) => (choices.find(m => m.id === id)?.name ?? id).replace(/^Claude /, '');
  const choose = (agent: string, model: string) => onChange({ ...models, [agent]: model });
  return (
    <Table head={['Agent', 'Job', 'Model', 'Why the recommended model']} rows={Object.entries(agents).map(([agent, info]) => {
      const model = models[agent] ?? info.recommended;
      return [
        <span className="font-mono text-xs">{agent}</span>,
        info.job,
        <div className="grid min-w-56 gap-1">
          <select aria-label={`Model for ${agent}`} className={inputCls} value={model} onChange={e => choose(agent, e.target.value)}>
            {choices.map(m => <option key={m.id} value={m.id}>{nameOf(m.id)}{m.id === info.recommended ? ' (recommended)' : ''}</option>)}
          </select>
          {model === info.recommended
            ? <span><Pill value="ok" label="Recommended" /></span>
            : <span><Button kind="ghost" onClick={() => choose(agent, info.recommended)} title={`Go back to ${nameOf(info.recommended)}`}>Use recommended</Button></span>}
        </div>,
        <span className="text-xs text-muted">{nameOf(info.recommended)}: {info.why}</span>,
      ];
    })} />
  );
}
