import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Event, type Interaction } from '../api';
import { Pill, type LiveStatus } from '../ui';
import { InteractionCard } from './NeedsYou';

/**
 * Everything the run did, as a conversation: agents talk in bubbles, their questions can be answered right
 * here, your answers show as your own bubbles, and tool calls and scripts fold into one plain line each
 * ("Read tests/login.ts", "Ran check_login.py · exit 0") that opens to the raw input and output.
 */
export function Activity({ events, stage, live = 'live', docked = false, empty }: { events: Event[]; stage?: string; live?: LiveStatus; docked?: boolean; empty?: string }) {
  const [follow, setFollow] = useState(true);
  const [showSteps, setShowSteps] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  // The same cache as the Needs you box (App.tsx), so a question answered in either place closes in both.
  const open = useQuery({ queryKey: ['interactions'], queryFn: () => api.get<Interaction[]>('/api/interactions'), refetchInterval: 3000 });
  const openIds = useMemo(() => new Set((open.data ?? []).map(i => i.id)), [open.data]);
  const items = useMemo(() => {
    const list = stage ? inStage(events, stage) : events;
    const all = toItems(list.slice(-1500));
    return showSteps ? all : all.filter(i => i.kind === 'event');
  }, [events, stage, showSteps]);
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [items.length, follow, openIds.size]);
  const liveLabel = live === 'live' ? 'Live' : live === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
  const waiting = live === 'reconnecting' ? 'Reconnecting to live activity…' : 'Connecting to live activity…';
  return (
    <div className={docked ? 'flex h-full min-h-0 flex-col gap-2' : 'grid gap-2'}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> Follow</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={showSteps} onChange={e => setShowSteps(e.target.checked)} /> Show steps (tools and scripts)</label>
        <span className="flex items-center gap-1.5" role="status">
          <span className={`h-1.5 w-1.5 rounded-full ${live === 'live' ? 'bg-good' : 'animate-pulse bg-warn'}`} />
          {liveLabel}
        </span>
      </div>
      {/* Any way of scrolling (wheel, scrollbar, keyboard) pauses following; back at the bottom resumes it. */}
      <div ref={box} role="log" aria-label="Activity" onScroll={e => {
        const el = e.currentTarget;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        if (atBottom !== follow) setFollow(atBottom);
      }}
        className={`live-scroll grid min-w-0 content-start gap-1.5 overflow-x-hidden overflow-y-auto p-3 text-sm ${docked ? 'min-h-0 flex-1' : 'max-h-[65vh] rounded-md border border-line bg-surface-2/40'}`}>
        <div className="grid w-full min-w-0 max-w-full gap-1.5">
        {items.length === 0 && (
          <p className="p-2 text-muted" role="status">
            {live === 'live' ? (empty ?? 'Nothing yet. Start the run to see its activity here.') : waiting}
          </p>
        )}
        {items.map(i => <ItemView key={i.key} item={i} openIds={openIds} />)}
        </div>
      </div>
    </div>
  );
}

// ---------------- events -> conversation items ----------------

/** A stage's events. Questions and answers carry no stage: they belong to the stage that was running then. */
function inStage(events: Event[], stage: string): Event[] {
  let current: string | undefined;
  return events.filter(e => {
    if (e.stage) current = e.stage;
    return (e.stage ?? current) === stage;
  });
}

type Item =
  | { kind: 'event'; key: string; e: Event }
  | { kind: 'tool'; key: string; call: Event; result?: Event }
  | { kind: 'script'; key: string; start: Event; lines: string[]; end?: Event };

/** Stop ends the work even when a script never gets its own closing line. */
function stopsTheWork(e: Event): boolean {
  return (e.type === 'run' && e.status === 'stopped')
    || (e.type === 'note' && /^Login setup stopped\b/.test(e.text ?? ''));
}

function closeOpenWork(script: Extract<Item, { kind: 'script' }> | null,
  openTools: Map<string, Extract<Item, { kind: 'tool' }>[]>, e: Event) {
  const why = e.reason || e.text || 'Stopped';
  if (script && !script.end) script.end = { ...e, type: 'script_end', code: 130, text: why };
  for (const queue of openTools.values()) {
    for (const item of queue) {
      if (!item.result) item.result = { ...e, type: 'tool_result', is_error: true, text: why };
    }
  }
  openTools.clear();
}

function toItems(events: Event[]): Item[] {
  const items: Item[] = [];
  const openTools = new Map<string, Extract<Item, { kind: 'tool' }>[]>();     // agent|tool -> calls waiting for a result
  let script: Extract<Item, { kind: 'script' }> | null = null;
  for (const e of events) {
    if (e.type === 'tool_call') {
      if (e.tool === 'ask_person') continue;                                    // the question itself shows as a bubble
      const item = { kind: 'tool' as const, key: `t${e.seq}`, call: e };
      const k = `${e.agent}|${e.tool}`;
      openTools.set(k, [...(openTools.get(k) ?? []), item]);
      items.push(item);
    } else if (e.type === 'tool_result') {
      if (e.tool === 'ask_person') continue;
      const queue = openTools.get(`${e.agent}|${e.tool}`);
      const item = queue?.shift();
      if (item) item.result = e;
    } else if (e.type === 'script_start') {
      script = { kind: 'script', key: `s${e.seq}`, start: e, lines: [] };
      items.push(script);
    } else if (e.type === 'script_line') {
      if (script && !script.end) script.lines.push(e.text ?? '');
    } else if (e.type === 'script_end') {
      if (script && !script.end) script.end = e;
      script = null;
    } else {
      if (stopsTheWork(e)) {
        closeOpenWork(script, openTools, e);
        script = null;
      }
      items.push({ kind: 'event', key: `e${e.seq}`, e });
    }
  }
  return items;
}

// ---------------- rendering ----------------

function time(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
      return <Meta e={e}><b className="text-accent">{e.agent}</b> joined · {e.model}</Meta>;
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
            ? <div className="-m-1"><InteractionCard item={it} compact /></div>
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

function tokens(e: Event) {
  const n = (e.input_tokens ?? 0) + (e.output_tokens ?? 0);
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="my-2 flex items-center gap-3 text-xs">
      <span className="h-px flex-1 bg-line" /><span className="flex items-center gap-1.5">{children}</span><span className="h-px flex-1 bg-line" />
    </div>
  );
}

function Meta({ e, children }: { e: Event; children: ReactNode }) {
  return <div className="text-center text-xs text-muted">{children} <span className="tnum">· {time(e.ts)}</span></div>;
}

function Avatar({ name }: { name: string }) {
  const short = name.replace(/^(uat|playwright-test)-/, '').slice(0, 2).toUpperCase();
  return <span aria-hidden className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent">{short}</span>;
}

function AgentBubble({ e, tone, children }: { e: Event; tone?: 'bad' | 'warn'; children: ReactNode }) {
  const border = tone === 'bad' ? 'border-bad/50' : tone === 'warn' ? 'border-warn/60' : 'border-line';
  const name = e.agent ?? 'The flow';
  return (
    <div className="my-1 flex w-full min-w-0 max-w-full gap-2">
      <Avatar name={name} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-xs text-muted"><b className="text-ink">{name}</b> · {time(e.ts)}</div>
        <div className={`break-words rounded-lg rounded-tl-sm border ${border} bg-surface p-3 ${tone === 'bad' ? 'text-bad' : ''}`}>{children}</div>
      </div>
    </div>
  );
}

function YouBubble({ e }: { e: Event & { response?: unknown; kind?: string } }) {
  return (
    <div className="my-1 ml-auto w-full min-w-0 max-w-[85%] break-words">
      <div className="mb-0.5 text-right text-xs text-muted"><b className="text-ink">You</b> · {time(e.ts)}</div>
      <div className="rounded-lg rounded-tr-sm bg-accent/12 p-3">{answerText(e.response)}</div>
    </div>
  );
}

function answerText(r: unknown): ReactNode {
  if (r === '__defer__') return 'Not available now. A questionnaire was written for the author.';
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object') {
    return <dl className="grid gap-1">{Object.entries(r as Record<string, unknown>).map(([k, v]) =>
      <div key={k}><dt className="inline font-semibold">{k}: </dt><dd className="inline">{String(v)}</dd></div>)}</dl>;
  }
  return 'Answered';
}

/** What an already answered question asked, short, so the conversation still reads in order. */
function AskedSummary({ item }: { item: Interaction }) {
  const p = item.payload ?? {};
  if (item.kind === 'question') {
    return <ol className="grid list-decimal gap-1 pl-5">{(p.questions ?? []).map((q: any) => <li key={q.id}>{q.text}</li>)}</ol>;
  }
  if (item.kind === 'guard') return <p>Asked to approve: {p.reason}</p>;
  return <p>{item.title}</p>;
}

// ---------------- folded steps ----------------

function ToolStep({ call, result }: { call: Event; result?: Event }) {
  const status = !result ? 'running' : result.is_error ? 'error' : 'ok';
  return (
    <details className="group min-w-0 max-w-full text-xs">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded px-1.5 py-0.5 text-muted hover:bg-surface">
        <StepIcon status={status} />
        <span className="min-w-0 flex-1 truncate"><span className="text-ink">{describe(call.tool ?? '', parse(call.input))}</span></span>
        <span className="ml-auto shrink-0 tnum opacity-0 group-hover:opacity-100">{time(call.ts)}</span>
      </summary>
      <div className="mt-1 mb-2 ml-6 grid gap-1 font-mono">
        <div className="text-muted">{call.tool}</div>
        <pre className="max-h-48 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all rounded bg-surface p-2">{pretty(call.input)}</pre>
        {result && <pre className={`max-h-64 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all rounded bg-surface p-2 ${result.is_error ? 'text-bad' : 'text-muted'}`}>
          {result.text}{result.images ? `\n[${result.images} image]` : ''}</pre>}
      </div>
    </details>
  );
}

function ScriptStep({ start, lines, end }: { start: Event; lines: string[]; end?: Event }) {
  const status = !end ? 'running' : end.code === 0 ? 'ok' : 'error';
  return (
    <details className="group min-w-0 max-w-full text-xs">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded px-1.5 py-0.5 text-muted hover:bg-surface">
        <StepIcon status={status} />
        <span className="min-w-0 flex-1 truncate"><span className="text-ink">Ran {scriptName(start.script)}</span>{end ? ` · exit ${end.code}` : ' · running'}
          {lastLine(lines, end) && <span> · {lastLine(lines, end)}</span>}</span>
        <span className="ml-auto shrink-0 tnum opacity-0 group-hover:opacity-100">{time(start.ts)}</span>
      </summary>
      <pre className="mt-1 mb-2 max-h-64 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all rounded bg-surface p-2 font-mono text-muted">
        $ {start.script}{'\n'}{lines.join('\n') || end?.text || ''}
      </pre>
    </details>
  );
}

function lastLine(lines: string[], end?: Event) {
  const all = lines.length ? lines : (end?.text ?? '').split('\n');
  const l = [...all].reverse().find(x => x.trim());
  return l && l.length > 42 ? l.slice(0, 42) + '…' : l;
}

function StepIcon({ status }: { status: 'running' | 'ok' | 'error' }) {
  if (status === 'running') return <span aria-label="running" className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-warn" />;
  return <span aria-label={status} className={`w-3 shrink-0 text-center ${status === 'ok' ? 'text-good' : 'text-bad'}`}>{status === 'ok' ? '✓' : '✗'}</span>;
}

function scriptName(s?: string) {
  if (!s) return 'a script';
  const file = s.match(/([\w.-]+\.(py|ts|js))/);
  if (file) return file[1];
  if (s.startsWith('npx ')) return s.length > 56 ? `${s.slice(0, 56)}…` : s;
  return s.split(' ')[0];
}

/** Tool inputs arrive as JSON cut at 300 characters; read what can be read. */
function parse(input?: string): Record<string, any> {
  if (!input) return {};
  try { return JSON.parse(input); } catch { /* cut short */ }
  const out: Record<string, string> = {};
  for (const m of input.matchAll(/"(\w+)":\s*"((?:[^"\\]|\\.)*)/g)) out[m[1]] = m[2];
  return out;
}

function pretty(input?: string) {
  try { return JSON.stringify(JSON.parse(input ?? ''), null, 2); } catch { return input ?? ''; }
}

const q = (s?: string) => (s ? `“${s}”` : '');

/** One plain sentence per tool call. Unknown tools fall back to their name and first value. */
function describe(tool: string, a: Record<string, any>): string {
  const t = tool.replace(/^.*\//, '').replace(/^mcp_[\w-]+?_/, '');
  const target = a.element ?? a.name ?? a.ref;
  switch (t) {
    case 'read_kit_file': case 'read': case 'read_file': return `Read ${a.path ?? a.file ?? 'a file'}`;
    case 'search': case 'grep': case 'search_kit': return `Searched for ${q(a.query ?? a.pattern)}`;
    case 'list_files': case 'list_dir': return `Listed ${a.path ?? 'files'}`;
    case 'write_file': case 'edit_file': case 'edit': return `Wrote ${a.path ?? a.file ?? 'a file'}`;
    case 'run_script': return `Ran ${a.script ?? a.name ?? 'a script'}`;
    case 'browser_navigate': return `Opened ${a.url ?? 'a page'}`;
    case 'browser_navigate_back': return 'Went back';
    case 'browser_click': return `Clicked ${q(target)}`;
    case 'browser_type': return `Typed ${a.text ? q(a.text) + ' ' : ''}into ${q(target)}`;
    case 'browser_fill_form': return 'Filled in a form';
    case 'browser_select_option': return `Chose ${q(Array.isArray(a.values) ? a.values.join(', ') : a.values)} in ${q(target)}`;
    case 'browser_hover': return `Pointed at ${q(target)}`;
    case 'browser_press_key': return `Pressed ${a.key}`;
    case 'browser_snapshot': return 'Looked at the page';
    case 'browser_take_screenshot': return 'Took a screenshot';
    case 'browser_wait_for': return a.text ? `Waited for ${q(a.text)}` : 'Waited';
    case 'browser_handle_dialog': return a.accept ? 'Accepted a dialog' : 'Dismissed a dialog';
    case 'browser_console_messages': return 'Read the console';
    case 'browser_network_requests': return 'Read the network requests';
    case 'planner_setup_page': case 'generator_setup_page': return `Opened the app from ${a.seedFile ?? 'the seed'}`;
    case 'generator_read_log': return 'Read what it did in the browser';
    case 'generator_write_test': return `Wrote ${a.fileName ?? 'the test'}`;
    case 'test_run': return `Ran ${a.locations?.join?.(', ') ?? 'tests'}`;
    case 'test_debug': return `Debugged ${a.test?.title ?? 'a test'}`;
    case 'test_list': return 'Listed the tests';
    case 'map_login_page': return `Had Playwright's planner look at the login page${a.start ? ` (${a.start})` : ''}`;
    case 'write_login_ts': return 'Wrote tests/login.ts';
    case 'check_login': return 'Checked that every account logs in';
    default: {
      const first = Object.values(a).find(v => typeof v === 'string') as string | undefined;
      const words = t.replace(/_/g, ' ');
      return first ? `${words[0].toUpperCase()}${words.slice(1)} ${q(first.length > 60 ? first.slice(0, 60) + '…' : first)}` : words;
    }
  }
}
