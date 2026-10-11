// The conversation's pieces: agent and person bubbles, dividers between stages, small notes.
import type { ReactNode } from 'react';
import type { Event, Interaction } from '../../api';

export function time(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}


export function tokens(e: Event) {
  const n = (e.input_tokens ?? 0) + (e.output_tokens ?? 0);
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="my-2 flex items-center gap-3 text-xs">
      <span className="h-px flex-1 bg-line" /><span className="flex items-center gap-1.5">{children}</span><span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function Meta({ e, children }: { e: Event; children: ReactNode }) {
  return <div className="text-center text-xs text-muted">{children} <span className="tnum">· {time(e.ts)}</span></div>;
}

function Avatar({ name }: { name: string }) {
  const short = name.replace(/^(uat|playwright-test)-/, '').slice(0, 2).toUpperCase();
  return <span aria-hidden className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-bold text-accent-ink">{short}</span>;
}

export function AgentBubble({ e, tone, children }: { e: Event; tone?: 'bad' | 'warn'; children: ReactNode }) {
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

export function YouBubble({ e }: { e: Event & { response?: unknown; kind?: string } }) {
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
export function AskedSummary({ item }: { item: Interaction }) {
  const p = item.payload ?? {};
  if (item.kind === 'question') {
    return <ol className="grid list-decimal gap-1 pl-5">{(p.questions ?? []).map(q => <li key={q.id}>{q.text}</li>)}</ol>;
  }
  if (item.kind === 'guard') return <p>Asked to approve: {p.reason}</p>;
  return <p>{item.title}</p>;
}
