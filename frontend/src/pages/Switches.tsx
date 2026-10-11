import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useAction } from '../lib/useAction';
import { Button, Card, Empty, Loading, Notice, Pill, Spinner, errorText, inputCls, useTitle } from '../ui';

type Item = { id: string; name: string; kind: string; area: string; status: string; core: boolean; core_reason?: string; what: string;
  requires: string[]; soft: { id: string; loss: string }[]; required_by: string[]; soft_by: { id: string; loss: string }[];
  needs_all: string[]; blocked_by: string[]; on: boolean; switched_off: boolean; files?: string[]; decisions?: number[] };
type Loss = { who: string; dep: string; loss: string };
type Preview = { allowed: boolean; reason?: string; also?: string[]; losses?: Loss[] };

const KIND: Record<string, string> = { stage: 'Stage', agent: 'Agent', skill: 'Skill', rule: 'Rule', part: 'Part', prompt: 'Command', future: 'Future', idea: 'Set aside' };

/** Switch parts of the flow on and off. What cannot work without a part goes off with it; what only works less well is named. */
export function SwitchesPage() {
  useTitle('Feature switches');
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['features'], queryFn: () => api.get<{ items: Item[]; losses: Loss[]; problems: string[] }>('/api/features') });
  const [q, setQ] = useState('');
  const [showPlanned, setShowPlanned] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; action: 'on' | 'off'; preview: Preview } | null>(null);
  const { busy: busyId, error, run } = useAction();
  const items = useMemo(() => data.data?.items ?? [], [data.data]);
  const byId = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items]);
  const groups = useMemo(() => {
    const g: Record<string, Item[]> = {};
    for (const i of items) {
      if (!showPlanned && i.status !== 'built') continue;
      if (q && !`${i.name} ${i.id} ${i.what}`.toLowerCase().includes(q.toLowerCase())) continue;
      (g[i.area] ??= []).push(i);
    }
    return g;
  }, [items, q, showPlanned]);

  // A switch that takes nothing else with it applies at once; otherwise the person sees what else changes first.
  const ask = (id: string, action: 'on' | 'off') => run(id, async () => {
    const preview = await api.post<Preview>('/api/features/switch', { id, action });
    setSelected(id);
    const immediate = preview.allowed && !preview.also?.length && !preview.losses?.length;
    if (!immediate) { setPending({ id, action, preview }); return; }
    await api.post('/api/features/switch', { id, action, apply: true });
    qc.invalidateQueries({ queryKey: ['features'] });
  });
  const apply = (id: string, action: 'on' | 'off') => run(id, async () => {
    await api.post('/api/features/switch', { id, action, apply: true });
    setPending(null);
    qc.invalidateQueries({ queryKey: ['features'] });
  });
  const builtOn = items.filter(i => i.status === 'built' && i.on).length;
  const builtOff = items.filter(i => i.status === 'built' && !i.on).length;
  const sel = selected ? byId[selected] : null;

  return (
    <div className="mx-auto grid max-w-7xl gap-4">
      <div>
        <h1 className="text-xl font-semibold">Feature switches</h1>
        <p className="text-sm text-muted">Every stage, agent, skill and rule of the flow, and what it depends on (config/features.yaml). Your choices are saved in config/profile.yaml, and the run follows them.</p>
      </div>
      {data.isPending ? <Loading label="Loading feature switches…" /> : data.isError ? <Notice>{errorText(data.error)}</Notice> : <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="tnum"><b>{builtOn}</b> on · <b>{builtOff}</b> off · <b>{items.filter(i => i.core).length}</b> core · <b>{items.filter(i => i.status === 'planned').length}</b> planned</span>
        <input className={`${inputCls} max-w-xs`} placeholder="Find a part" value={q} onChange={e => setQ(e.target.value)} />
        <label className="flex items-center gap-1.5 text-muted"><input type="checkbox" checked={showPlanned} onChange={e => setShowPlanned(e.target.checked)} /> Future and set-aside ideas</label>
      </div>
      {data.data?.problems?.length ? <p className="text-sm text-bad">{data.data.problems.join(' · ')}</p> : null}
      {data.data?.losses?.length ? (
        <Card title={`Works less well with this profile · ${data.data.losses.length}`}>
          <ul className="grid gap-1 text-sm">{data.data.losses.map((l, i) => <li key={i}><b>{byId[l.who]?.name}</b>: {l.loss}</li>)}</ul>
        </Card>
      ) : null}
      {error && <Notice>{error}</Notice>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          {Object.entries(groups).map(([area, list]) => (
            <Card key={area} title={`${area} · ${list.length}`}>
              <ul className="divide-y divide-line">
                {list.map(i => {
                  const locked = i.core || i.status !== 'built' || !!busyId;
                  return (
                    <li key={i.id} className={`flex items-center gap-3 py-2 ${selected === i.id ? 'bg-accent-soft/50 -mx-2 px-2 rounded' : ''}`}>
                      <button role="switch" aria-checked={i.on} aria-busy={busyId === i.id || undefined} aria-label={`Switch ${i.name}`} disabled={locked}
                        onClick={() => ask(i.id, i.on ? 'off' : 'on')}
                        className={`relative h-5 w-9 shrink-0 rounded-full transition ${i.on ? 'bg-accent' : 'bg-line'} ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition ${i.on ? 'left-4.5' : 'left-0.5'}`} />
                      </button>
                      <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(i.id)}>
                        <div className="flex items-center gap-2 truncate text-sm font-medium">{i.name}{busyId === i.id && <Spinner className="h-3 w-3 text-muted" />}</div>
                        <div className="truncate font-mono text-xs text-muted">{i.id}</div>
                      </button>
                      <span className="hidden text-xs text-muted sm:inline">{KIND[i.kind] ?? i.kind}</span>
                      {i.core && <Pill value="core" />}
                      {i.status !== 'built' && <Pill value={i.status} />}
                      {i.status === 'built' && !i.on && !i.switched_off && <Pill value="off" label={`off: needs ${i.blocked_by.map(b => byId[b]?.name ?? b).join(', ')}`} />}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
          {Object.keys(groups).length === 0 && <Card><Empty>{q ? 'No part matches that search.' : 'No parts to show.'}</Empty></Card>}
        </div>
        <div className="lg:sticky lg:top-4 lg:self-start grid gap-4">
          {pending && (
            <Card title={pending.preview.allowed ? `Switch ${pending.action} ${byId[pending.id]?.name}?` : `Cannot switch ${pending.action} ${byId[pending.id]?.name}`}>
              {!pending.preview.allowed && <p className="text-sm">{pending.preview.reason}</p>}
              {pending.preview.also?.length ? <div className="text-sm"><p className="font-medium">{pending.action === 'off' ? 'Also off (cannot work without it):' : 'Also on (it needs them):'}</p>
                <ul className="list-disc pl-5">{pending.preview.also.map(a => <li key={a}>{byId[a]?.name ?? a}</li>)}</ul></div> : null}
              {pending.preview.losses?.length ? <div className="mt-2 text-sm"><p className="font-medium">Works less well:</p>
                <ul className="list-disc pl-5">{pending.preview.losses.map((l, n) => <li key={n}><b>{byId[l.who]?.name}</b>: {l.loss}</li>)}</ul></div> : null}
              <div className="mt-3 flex gap-2">
                {pending.preview.allowed && <Button kind="primary" busy={busyId === pending.id} onClick={() => apply(pending.id, pending.action)}>
                  {busyId === pending.id ? 'Switching…' : `Switch ${pending.action}${pending.preview.also?.length ? ` ${pending.preview.also.length + 1} parts` : ''}`}</Button>}
                <Button disabled={busyId === pending.id} onClick={() => setPending(null)}>{pending.preview.allowed ? 'Cancel' : 'Close'}</Button>
              </div>
            </Card>
          )}
          {sel ? <Inspector item={sel} byId={byId} onSelect={setSelected} /> : <Card><Empty>Pick a part to see what it needs and what needs it.</Empty></Card>}
        </div>
      </div>
      </>}
    </div>
  );
}

type Pick = { byId: Record<string, Item>; onSelect: (id: string) => void };

/** A part's name that selects it. */
function PartLink({ id, byId, onSelect }: Pick & { id: string }) {
  return <button className="text-link hover:underline" onClick={() => onSelect(id)}>{byId[id]?.name ?? id}</button>;
}

/** What a part needs, and what those need in turn (each part once per branch). */
function NeedsTree({ id, depth, seen, byId, onSelect }: Pick & { id: string; depth: number; seen: Set<string> }) {
  return (
    <ul className={depth ? 'ml-4 border-l border-line pl-3' : ''}>
      {(byId[id]?.requires ?? []).map(r => (
        <li key={r} className="py-0.5 text-sm">
          <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${byId[r]?.on ? 'bg-good' : 'bg-bad'}`} /><PartLink id={r} byId={byId} onSelect={onSelect} />
          {!seen.has(r) && <NeedsTree id={r} depth={depth + 1} seen={new Set([...seen, r])} byId={byId} onSelect={onSelect} />}
        </li>
      ))}
    </ul>
  );
}

function Inspector({ item, byId, onSelect }: { item: Item } & Pick) {
  const link = { byId, onSelect };
  return (
    <Card title={item.name}>
      <div className="grid gap-3 text-sm">
        <div className="flex flex-wrap gap-1.5"><span className="font-mono text-xs text-muted">{item.id}</span>
          <Pill value={item.on ? 'on' : 'off'} />{item.core && <Pill value="core" />}<span className="text-xs text-muted">{KIND[item.kind]} · {item.area}</span></div>
        <p>{item.what}</p>
        {item.core && item.core_reason && <p className="text-muted">Locked on: {item.core_reason}</p>}
        {item.requires.length > 0 && <div><h3 className="font-medium">Needs</h3><NeedsTree id={item.id} depth={0} seen={new Set([item.id])} {...link} /></div>}
        {item.soft.length > 0 && <div><h3 className="font-medium">Works less well without</h3>
          <ul className="grid gap-1">{item.soft.map(s => <li key={s.id}><PartLink id={s.id} {...link} />: {s.loss}</li>)}</ul></div>}
        {item.required_by.length > 0 && <div><h3 className="font-medium">Needed by</h3>
          <p className="flex flex-wrap gap-x-3">{item.required_by.map(r => <PartLink key={r} id={r} {...link} />)}</p></div>}
        {item.soft_by.length > 0 && <div><h3 className="font-medium">Makes these work better</h3>
          <ul className="grid gap-1">{item.soft_by.map(s => <li key={s.id}><PartLink id={s.id} {...link} />: without it, {s.loss.charAt(0).toLowerCase() + s.loss.slice(1)}</li>)}</ul></div>}
        {item.files?.length ? <div><h3 className="font-medium">Files</h3><ul className="font-mono text-xs">{item.files.map(f => <li key={f}>{f}</li>)}</ul></div> : null}
        {item.decisions?.length ? <p className="text-xs text-muted">Decisions {item.decisions.join(', ')}</p> : null}
      </div>
    </Card>
  );
}
