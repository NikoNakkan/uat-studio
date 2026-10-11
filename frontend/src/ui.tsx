import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Event } from './api';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

export function Spinner({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <span className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} aria-hidden />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <Spinner />
      {label}
    </p>
  );
}

export function Notice({ tone = 'bad', children }: { tone?: 'bad' | 'good' | 'muted'; children: ReactNode }) {
  return (
    <p role={tone === 'bad' ? 'alert' : 'status'} className={`text-sm ${tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-muted'}`}>
      {children}
    </p>
  );
}

/** An outcome message: whether it is good news is decided where it is created, never by matching its text. */
export type Msg = { text: string; ok: boolean } | null;
export const ok = (text: string): Msg => ({ text, ok: true });
export const fail = (e: unknown): Msg => ({ text: errorText(e), ok: false });

export function MsgNotice({ msg, className = 'mt-2' }: { msg: Msg; className?: string }) {
  if (!msg) return null;
  return <div className={className}><Notice tone={msg.ok ? 'good' : 'bad'}>{msg.text}</Notice></div>;
}

/** One screenshot that shows a placeholder while it loads and says so when it cannot be loaded. Opens full size. */
export function Shot({ src, caption, mono = false }: { src: string; caption: string; mono?: boolean }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  return (
    <figure className="grid min-w-0 gap-1">
      <a href={src} target="_blank" rel="noreferrer" className="relative block">
        {state === 'loading' && <div className="h-40 animate-pulse rounded bg-surface-2" role="status" aria-label={`Loading ${caption}`} />}
        {state === 'error' && <p className="rounded border border-line p-3 text-xs text-muted">This screenshot could not be loaded.</p>}
        <img src={src} alt={caption} loading="lazy"
          ref={img => { if (img?.complete && img.naturalWidth > 0) setState('ready'); }}
          onLoad={() => setState('ready')} onError={() => setState('error')}
          className={`w-full rounded border border-line ${state === 'ready' ? '' : 'absolute h-px w-px opacity-0'}`} />
      </a>
      <figcaption className={`text-xs text-muted ${mono ? 'font-mono' : ''}`}>{caption}</figcaption>
    </figure>
  );
}

/** Initial load and hard failures. A background refetch keeps the children on screen. */
export function QueryGate({ pending, error, label = 'Loading…', children }: {
  pending: boolean; error?: unknown; label?: string; children: ReactNode;
}) {
  if (pending) return <Loading label={label} />;
  if (error != null) return <Notice>{errorText(error)}</Notice>;
  return <>{children}</>;
}

export function useTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · UAT Studio`;
    return () => { document.title = previous; };
  }, [title]);
}

export function Button({ children, onClick, kind = 'default', disabled, busy = false, type = 'button', title }: {
  children: ReactNode; onClick?: () => void; kind?: 'default' | 'primary' | 'danger' | 'ghost'; disabled?: boolean;
  busy?: boolean; type?: 'button' | 'submit'; title?: string;
}) {
  const styles = {
    default: 'border border-line bg-surface hover:bg-surface-2 text-ink',
    primary: 'bg-accent text-accent-ink hover:opacity-90',
    danger: 'border border-bad text-bad hover:bg-bad/10',
    ghost: 'text-accent hover:bg-accent-soft',
  }[kind];
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${styles}`}>
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

const PILL: Record<string, string> = {
  done: 'bg-good/15 text-good', ok: 'bg-good/15 text-good', PASS: 'bg-good/15 text-good', passed: 'bg-good/15 text-good',
  ACCEPT: 'bg-good/15 text-good', stable: 'bg-good/15 text-good', explained: 'bg-good/15 text-good', on: 'bg-good/15 text-good',
  started: 'bg-info/15 text-info', running: 'bg-info/15 text-info',
  waiting_for_person: 'bg-warn/15 text-warn', waiting: 'bg-warn/15 text-warn', CONCERNS: 'bg-warn/15 text-warn',
  WARN: 'bg-warn/15 text-warn', MANUAL: 'bg-info/15 text-info', unexplained: 'bg-warn/15 text-warn', unreliable: 'bg-warn/15 text-warn',
  failed: 'bg-bad/15 text-bad', FAIL: 'bg-bad/15 text-bad', MISSING: 'bg-bad/15 text-bad', BROKEN: 'bg-bad/15 text-bad',
  REJECT: 'bg-bad/15 text-bad', timedOut: 'bg-bad/15 text-bad', failing: 'bg-bad/15 text-bad', WAIVED: 'bg-info/15 text-info',
  skipped: 'bg-surface-2 text-muted', off: 'bg-surface-2 text-muted', '-': 'bg-surface-2 text-muted',
  core: 'bg-surface-2 text-ink', planned: 'bg-surface-2 text-muted', 'set-aside': 'bg-surface-2 text-muted',
};

const LIVE_PILL = new Set(['running', 'started']);

export function Pill({ value, label }: { value: string; label?: string }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${PILL[value] ?? 'bg-surface-2 text-muted'}`}>
    {LIVE_PILL.has(value) ? <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden /> : null}
    {label ?? (value === '-' ? 'not started' : value.replaceAll('_', ' '))}</span>;
}

export function Card({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${className}`}>
      {(title || actions) && <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>}
      <div className="p-4 min-w-0">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

export function Pre({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <pre className={`rounded-md bg-surface-2 p-3 font-mono text-xs leading-relaxed overflow-x-auto ${className}`}>{children}</pre>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-muted';

export function Tabs({ tabs, current, onChange }: { tabs: { id: string; label: string; badge?: number }[]; current: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={current === t.id} onClick={() => onChange(t.id)}
          className={`whitespace-nowrap px-3 py-2 text-sm -mb-px border-b-2 ${current === t.id ? 'border-accent text-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}>
          {t.label}{t.badge ? <span className="ml-1.5 rounded bg-warn/15 px-1 text-xs text-warn tnum">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

function columnFractions(resize: boolean | number[] | undefined, n: number): number[] | null {
  if (!resize) return null;
  const weights = Array.isArray(resize) && resize.length === n ? resize : Array.from({ length: n }, () => 1);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map(w => w / sum);
}

export function Table({ head, rows, resize }: {
  head: ReactNode[]; rows: ReactNode[][];
  /** Drag a header edge to share width with the next column. Weights are the starting share of each column. */
  resize?: boolean | number[];
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; x: number; fracs: number[]; width: number } | null>(null);
  const [fracs, setFracs] = useState<number[] | null>(() => columnFractions(resize, head.length));
  const nudge = (i: number, px: number) => {
    const width = scroller.current?.clientWidth || 1;
    setFracs(prev => {
      if (!prev || i + 1 >= prev.length) return prev;
      const min = 56 / width;
      const delta = Math.max(-(prev[i] - min), Math.min(prev[i + 1] - min, px / width));
      const next = prev.slice();
      next[i] += delta;
      next[i + 1] -= delta;
      return next;
    });
  };
  const onPointerDown = (i: number, e: ReactPointerEvent<HTMLElement>) => {
    if (!fracs) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { i, x: e.clientX, fracs, width: scroller.current?.clientWidth || 1 };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const min = 56 / d.width;
    const delta = Math.max(-(d.fracs[d.i] - min), Math.min(d.fracs[d.i + 1] - min, (e.clientX - d.x) / d.width));
    const next = d.fracs.slice();
    next[d.i] += delta;
    next[d.i + 1] -= delta;
    setFracs(next);
  };
  if (!fracs) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-muted">{head.map((h, i) => <th key={i} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line/60 align-top hover:bg-surface-2/50">{r.map((c, j) => <td key={j} className="px-2 py-1.5">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  return (
    <div ref={scroller} className="min-w-0 overflow-x-clip">
      <table className="w-full table-fixed text-sm">
        <colgroup>{fracs.map((f, i) => <col key={i} style={{ width: `${f * 100}%` }} />)}</colgroup>
        <thead><tr className="border-b border-line text-left text-xs text-muted">{head.map((h, i) => (
          <th key={i} className="relative px-1.5 py-1.5 font-medium break-words">
            {h}
            {i < head.length - 1 && (
              <span role="separator" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fracs[i] * 100)}
                aria-label={typeof h === 'string' ? `Resize ${h}` : `Resize column ${i + 1}`} title="Drag to resize"
                tabIndex={0}
                className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-accent/40"
                onPointerDown={e => onPointerDown(i, e)} onPointerMove={onPointerMove}
                onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
                onKeyDown={e => {
                  if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(i, -16); }
                  if (e.key === 'ArrowRight') { e.preventDefault(); nudge(i, 16); }
                }} />
            )}
          </th>
        ))}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line/60 align-top hover:bg-surface-2/50">{r.map((c, j) =>
          <td key={j} className="px-1.5 py-1.5 break-words [overflow-wrap:anywhere]">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Live events of a run (or the app channel) over Server-Sent Events. Refreshes the given queries on milestones. */
export function useEvents(channelUrl: string | null, refresh: unknown[][] = []) {
  const [events, setEvents] = useState<Event[]>([]);
  const [live, setLive] = useState<LiveStatus>('connecting');
  const qc = useQueryClient();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!channelUrl) return;
    setEvents([]);
    let lastSeq = 0;
    setLive('connecting');
    let dead = false;
    let es: EventSource | null = null;
    // A browser keeps at most 6 connections per server, and each live feed holds one open. With several Studio
    // tabs every other request (evidence, files) queued forever, so a hidden tab closes its feed and reopens it
    // when shown again. The server replays the channel; events already shown are skipped by sequence number.
    const open = () => {
      if (es || dead) return;
      es = new EventSource(channelUrl);
      es.onopen = () => { if (!dead) setLive('live'); };
      es.onerror = () => { if (!dead) setLive('reconnecting'); };
      es.onmessage = msg => {
        const e = JSON.parse(msg.data) as Event;
        if (e.seq <= lastSeq) return;
        lastSeq = e.seq;
        setEvents(prev => (prev.length > 3000 ? [...prev.slice(-2500), e] : [...prev, e]));
        if (['stage', 'run', 'waiting', 'answered', 'script_end', 'agent_end', 'finding'].includes(e.type)) {
          for (const key of refreshRef.current) qc.invalidateQueries({ queryKey: key });
        }
      };
    };
    const close = () => { es?.close(); es = null; };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') close();
      else { setLive('connecting'); open(); for (const key of refreshRef.current) qc.invalidateQueries({ queryKey: key }); }
    };
    if (document.visibilityState !== 'hidden') open();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { dead = true; close(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [channelUrl, qc]);
  return { events, live };
}

export function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
