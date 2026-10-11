import { useEffect, useState, type ReactNode } from 'react';
import { errorText } from './lib/errors';

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
    primary: 'bg-accent font-semibold text-accent-ink hover:brightness-95',
    danger: 'border border-bad text-bad hover:bg-bad/10',
    ghost: 'text-link hover:bg-accent-soft',
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

// Shared pieces that live in their own files, re-exported so pages import every UI primitive from one place.
export { Table } from './components/Table';
export { errorText } from './lib/errors';
export type { LiveStatus } from './lib/useEvents';
