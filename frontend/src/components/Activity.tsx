import { useEffect, useMemo, useRef, useState } from 'react';
import type { Event } from '../api';
import { useInteractions } from '../lib/queries';
import { Pill, type LiveStatus } from '../ui';
import { InteractionCard } from './InteractionCard';
import { AgentBubble, AskedSummary, Divider, Meta, YouBubble, tokens } from './activity/Bubbles';
import { inStage, toItems, type Item } from './activity/items';
import { ScriptStep, ToolStep } from './activity/Steps';

/**
 * Everything the run did, as a conversation: agents talk in bubbles, their questions can be answered right
 * here, your answers show as your own bubbles, and tool calls and scripts fold into one plain line each
 * ("Read tests/login.ts", "Ran check_login.py · exit 0") that opens to the raw input and output.
 */
export function Activity({ events, stage, live = 'live', docked = false, empty, focusTick = 0 }: {
  events: Event[]; stage?: string; live?: LiveStatus; docked?: boolean; empty?: string; focusTick?: number;
}) {
  const [follow, setFollow] = useState(true);
  const [pausedAt, setPausedAt] = useState(0);         // how many items there were when following stopped
  const [showSteps, setShowSteps] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(follow);
  const handledFocus = useRef(focusTick);
  const lastTop = useRef(0);
  // The same cache as the Needs you box (App.tsx), so a question answered in either place closes in both.
  const open = useInteractions();
  const openIds = useMemo(() => new Set((open.data ?? []).map(i => i.id)), [open.data]);
  const items = useMemo(() => {
    const list = stage ? inStage(events, stage) : events;
    const all = toItems(list.slice(-1500));
    return showSteps ? all : all.filter(i => i.kind === 'event');
  }, [events, stage, showSteps]);
  // Keep the newest message in view while following: runs when messages or open questions are added, which the
  // body does not read (it reads the DOM), hence the listed dependencies.
  useEffect(() => {
    following.current = follow;
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [items.length, follow, openIds.size]);
  // Content also grows without new items (a question card loads, a step opens): keep the bottom in view then too.
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const keep = new ResizeObserver(() => { if (following.current && box.current) box.current.scrollTop = box.current.scrollHeight; });
    keep.observe(el);
    return () => keep.disconnect();
  }, []);
  // "1 waiting for you" asks to see the open question: scroll to it once it is on screen. The question may arrive
  // after the request (another page's feed loads first), so it tries again as items and open questions change.
  useEffect(() => {
    if (focusTick === handledFocus.current) return;
    const card = box.current?.querySelector('[data-open-question]');
    if (!card) return;
    handledFocus.current = focusTick;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [focusTick, items.length, openIds.size]);
  const unseen = follow ? 0 : Math.max(0, items.length - pausedAt);
  const toBottom = () => { setFollow(true); box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }); };
  const liveLabel = live === 'live' ? 'Live' : live === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
  const waiting = live === 'reconnecting' ? 'Reconnecting to live activity…' : 'Connecting to live activity…';
  return (
    <div className={`relative ${docked ? 'flex h-full min-h-0 flex-col gap-2' : 'grid gap-2'}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={follow} onChange={e => e.target.checked ? toBottom() : (setFollow(false), setPausedAt(items.length))} /> Follow</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={showSteps} onChange={e => setShowSteps(e.target.checked)} /> Show steps (tools and scripts)</label>
        <span className="flex items-center gap-1.5" role="status">
          <span className={`h-1.5 w-1.5 rounded-full ${live === 'live' ? 'bg-good' : 'animate-pulse bg-warn'}`} />
          {liveLabel}
        </span>
      </div>
      {/* Any way of scrolling (wheel, scrollbar, keyboard) pauses following; back at the bottom resumes it. */}
      <div ref={box} role="log" aria-label="Activity" onScroll={e => {
        // Only the person scrolls up; keeping up with new messages only ever scrolls down. Judging by "not at the
        // bottom" instead stopped following while history replayed: more arrived before the scroll was reported.
        const el = e.currentTarget;
        const up = el.scrollTop < lastTop.current - 2;
        lastTop.current = el.scrollTop;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        if (follow && up && !atBottom) { setFollow(false); setPausedAt(items.length); }
        else if (!follow && atBottom) setFollow(true);
      }}
        className={`live-scroll grid min-w-0 content-start gap-1.5 overflow-x-hidden overflow-y-auto p-3 text-sm ${docked ? 'min-h-0 flex-1' : 'max-h-[65vh] rounded-md border border-line bg-surface-2/40'}`}>
        <div ref={content} className="grid w-full min-w-0 max-w-full gap-1.5">
        {items.length === 0 && (
          <p className="p-2 text-muted" role="status">
            {live === 'live' ? (empty ?? 'Nothing yet. Start the run to see its activity here.') : waiting}
          </p>
        )}
        {items.map(i => <ItemView key={i.key} item={i} openIds={openIds} />)}
        </div>
      </div>
      {unseen > 0 && (
        <button type="button" onClick={toBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink shadow-md hover:brightness-95">
          {unseen} new ↓</button>
      )}
    </div>
  );
}

function ItemView({ item, openIds }: { item: Item; openIds: Set<string> }) {
  if (item.kind === 'tool') return <ToolStep call={item.call} result={item.result} />;
  if (item.kind === 'script') return <ScriptStep start={item.start} lines={item.lines} end={item.end} />;
  const e = item.e;
  switch (e.type) {
    case 'run':
      return <Divider><b>Run {e.status}</b>{e.reason ? ` · ${e.reason}` : ''}</Divider>;
    case 'stage':
      return <Divider><b>{e.stage}</b> <Pill value={e.status ?? '-'} />{e.note ? <span className="text-muted"> {e.note}</span> : null}</Divider>;
    case 'agent_start':
      return <Meta e={e}><b className="bg-accent px-1 text-accent-ink">{e.agent}</b> joined · {e.model}</Meta>;
    case 'agent_text':
      return <AgentBubble e={e}><div className="whitespace-pre-wrap">{e.text}</div></AgentBubble>;
    case 'agent_end':
      return <Meta e={e}>{e.agent} finished · {e.turns} turns · {tokens(e)} tokens</Meta>;
    case 'agent_error':
      return <AgentBubble e={e} tone="bad"><div className="whitespace-pre-wrap">{e.text}</div></AgentBubble>;
    case 'waiting': {
      const it = e.interaction;
      if (!it) return null;
      const isOpen = openIds.has(it.id);
      return (
        <AgentBubble e={{ ...e, agent: it.payload?.agent ?? e.agent ?? 'The flow' }} tone={isOpen ? 'warn' : undefined}>
          {isOpen
            ? <div className="-m-1" data-open-question><InteractionCard item={it} /></div>
            : <AskedSummary item={it} />}
        </AgentBubble>
      );
    }
    case 'answered':
      return <YouBubble e={e} />;
    case 'finding':
      return <Meta e={e}><span className="text-warn">Finding: {e.text}</span></Meta>;
    case 'note':
      return <Meta e={e}>{e.text}</Meta>;
    default:
      return <Meta e={e}>{e.type} {e.text ?? ''}</Meta>;
  }
}
