import { useEffect, useRef, useState, type ReactNode } from 'react';
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

export function Table({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-xs text-muted">{head.map((h, i) => <th key={i} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line/60 align-top hover:bg-surface-2/50">{r.map((c, j) => <td key={j} className="px-2 py-1.5">{c}</td>)}</tr>)}</tbody>
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
    setLive('connecting');
    let dead = false;
    const es = new EventSource(channelUrl);
    es.onopen = () => { if (!dead) setLive('live'); };
    es.onerror = () => { if (!dead) setLive('reconnecting'); };
    es.onmessage = msg => {
      const e = JSON.parse(msg.data) as Event;
      setEvents(prev => (prev.length > 3000 ? [...prev.slice(-2500), e] : [...prev, e]));
      if (['stage', 'run', 'waiting', 'answered', 'script_end', 'agent_end', 'finding'].includes(e.type)) {
        for (const key of refreshRef.current) qc.invalidateQueries({ queryKey: key });
      }
    };
    return () => { dead = true; es.close(); };
  }, [channelUrl, qc]);
  return { events, live };
}

export function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
