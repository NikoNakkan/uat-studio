import { useEffect, useMemo, useRef, useState } from 'react';
import type { Event } from '../api';
import { Pill, type LiveStatus } from '../ui';

/** Everything the run did, in order: stages, script output, agent messages and tool calls. */
export function Activity({ events, stage, live = 'live' }: { events: Event[]; stage?: string; live?: LiveStatus }) {
  const [follow, setFollow] = useState(true);
  const [showTools, setShowTools] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    let list = stage ? events.filter(e => e.stage === stage || e.type === 'run') : events;
    if (!showTools) list = list.filter(e => !['tool_call', 'tool_result', 'script_line'].includes(e.type));
    return list.slice(-1500);
  }, [events, stage, showTools]);
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown.length, follow]);
  const liveLabel = live === 'live' ? 'Live' : live === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
  const waiting = live === 'reconnecting' ? 'Reconnecting to live activity…' : 'Connecting to live activity…';
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> Follow</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={showTools} onChange={e => setShowTools(e.target.checked)} /> Tool calls and script lines</label>
        <span className="tnum">{shown.length} events{stage ? ` in ${stage}` : ''}</span>
        <span className="flex items-center gap-1.5" role="status">
          <span className={`h-1.5 w-1.5 rounded-full ${live === 'live' ? 'bg-good' : 'animate-pulse bg-warn'}`} />
          {liveLabel}
        </span>
      </div>
      <div ref={box} onWheel={e => { if (e.deltaY < 0) setFollow(false); }}
        className="max-h-[60vh] overflow-y-auto rounded-md border border-line bg-surface-2/50 p-2 font-mono text-xs leading-relaxed">
        {shown.length === 0 && (
          <p className="p-2 font-sans text-sm text-muted" role="status">
            {live === 'live' ? 'Nothing yet. Start the run to see its activity here.' : waiting}
          </p>
        )}
        {shown.map(e => <Line key={e.seq} e={e} />)}
      </div>
    </div>
  );
}

function time(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function Line({ e }: { e: Event }) {
  const t = <span className="text-muted">{time(e.ts)} </span>;
  switch (e.type) {
    case 'run':
      return <div className="my-1 font-sans text-sm font-semibold">{t}Run {e.status}{e.reason ? `: ${e.reason}` : ''}</div>;
    case 'stage':
      return <div className="mt-2 mb-1 flex items-center gap-2 font-sans text-sm">{t}<b>{e.stage}</b> <Pill value={e.status ?? '-'} />
        {e.note && <span className="text-muted">{e.note}</span>}</div>;
    case 'script_start':
      return <div>{t}<span className="text-info">$ {e.script}</span></div>;
    case 'script_line':
      return <div className="pl-6 text-muted">{e.text}</div>;
    case 'script_end':
      return <details className="pl-6"><summary className={e.code === 0 ? 'text-good' : 'text-warn'}>exit {e.code}</summary>
        <pre className="text-muted">{e.text}</pre></details>;
    case 'agent_start':
      return <div className="font-sans">{t}<b className="text-accent">{e.agent}</b> started ({e.model})</div>;
    case 'agent_text':
      return <div className="my-1 rounded bg-surface p-2 font-sans text-sm whitespace-pre-wrap"><b className="text-accent">{e.agent}: </b>{e.text}</div>;
    case 'tool_call':
      return <div className="pl-4">{t}<span className="text-ink">→ {e.tool}</span> <span className="text-muted">{e.input}</span></div>;
    case 'tool_result':
      return <div className={`pl-8 ${e.is_error ? 'text-bad' : 'text-muted'}`}>← {e.text}{e.images ? ` [${e.images} image]` : ''}</div>;
    case 'agent_end':
      return <div className="font-sans text-muted">{t}{e.agent} finished: {e.turns} turns, {e.input_tokens?.toLocaleString()} in / {e.output_tokens?.toLocaleString()} out tokens{e.status ? '' : ''}</div>;
    case 'agent_error':
      return <div className="font-sans text-bad">{t}{e.agent ?? ''} {e.text}</div>;
    case 'waiting':
      return <div className="font-sans text-warn">{t}Waiting for you: {e.interaction?.title}</div>;
    case 'answered':
      return <div className="font-sans text-good">{t}Answered</div>;
    case 'finding':
      return <div className="font-sans text-warn">{t}Finding: {e.text}</div>;
    case 'note':
      return <div className="font-sans">{t}{e.text}</div>;
    default:
      return <div>{t}{e.type} {e.text ?? ''}</div>;
  }
}
