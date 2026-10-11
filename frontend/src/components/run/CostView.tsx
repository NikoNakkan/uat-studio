import { useState } from 'react';
import type { CostItem, RunCost } from '../../api';
import { COST_NOTE, usd } from '../../lib/money';
import { Card, Empty, Tabs } from '../../ui';
import { STAGES } from './stages';

const VIEWS = [
  { id: 'by_stage', label: 'By stage' },
  { id: 'by_agent', label: 'By agent' },
  { id: 'by_model', label: 'By model' },
] as const;
type View = (typeof VIEWS)[number]['id'];

const label = (view: View, key: string) => view === 'by_stage' ? STAGES[key]?.title ?? key : key;

/** What this run cost in AI, and where the money went: by stage, by agent or by model. */
export function CostView({ cost }: { cost: RunCost }) {
  return (
    <Card title="Estimated cost of this run" actions={<span className="text-2xl font-semibold tnum" title={COST_NOTE}>{usd(cost.total)}</span>}>
      {cost.calls ? <CostBreakdown cost={cost} /> : <Empty>No AI work recorded for this run yet.</Empty>}
    </Card>
  );
}

/** The calls and tokens, then one bar per stage, agent or model; shared by the run page and the run cards. */
export function CostBreakdown({ cost }: { cost: RunCost }) {
  const [view, setView] = useState<View>('by_stage');
  const items = cost[view];
  const top = Math.max(...items.map(i => i.cost), 0.0001);
  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        {cost.calls} agent call{cost.calls === 1 ? '' : 's'} · {cost.tokens.input.toLocaleString()} input and {cost.tokens.output.toLocaleString()} output tokens
        {cost.tokens.cache_read > 0 && ` · ${cost.tokens.cache_read.toLocaleString()} read from the cache at a tenth of the price`}
      </p>
      <Tabs tabs={VIEWS.map(v => ({ id: v.id, label: v.label }))} current={view} onChange={id => setView(id as View)} />
      <ul className="mt-3 grid gap-2">{items.map(i => <Row key={i.key} item={i} name={label(view, i.key)} share={i.cost / top} mono={view !== 'by_stage'} />)}</ul>
      <p className="mt-3 text-xs text-muted">
        An estimate from the tokens used and list prices, not the bill.
        {cost.estimated && ' Part of this run was recorded before cached tokens were counted apart, so it reads high: those calls are priced as if nothing came from the cache.'}
        {' '}The billed amount is in the <a className="text-link hover:underline" href="https://console.anthropic.com/settings/cost" target="_blank" rel="noreferrer">Anthropic Console</a>.
      </p>
      {cost.unpriced.length > 0 && <p className="mt-1 text-xs text-muted">No price known for {cost.unpriced.join(', ')}; those calls count as $0.</p>}
    </div>
  );
}

function Row({ item, name, share, mono }: { item: CostItem; name: string; share: number; mono: boolean }) {
  return (
    <li className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_5.5rem] items-center gap-3 text-sm">
      <span className={`truncate ${mono ? 'font-mono text-xs' : ''}`} title={name}>{name}</span>
      <span className="flex items-center gap-2">
        <span className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(2, share * 100)}%` }} aria-hidden />
        <span className="shrink-0 text-xs text-muted">{item.calls} call{item.calls === 1 ? '' : 's'}</span>
      </span>
      <span className="text-right font-medium tnum">{usd(item.cost)}</span>
    </li>
  );
}
