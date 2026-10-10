import { useEffect, useRef, useState, type ReactNode } from 'react';

export type StepState = 'done' | 'current' | 'waiting' | 'failed' | 'todo' | 'off';

export type StepDef = {
  id: string;
  title: string;
  /** One line shown under the title, open or closed: what the step did or will do. */
  summary?: ReactNode;
  state: StepState;
  body: ReactNode;
};

/**
 * A vertical stepper: one step open at a time. The step that needs the person (waiting), or else the one in
 * progress, opens by itself; any other step opens on click. Nothing pops up elsewhere on the page.
 */
export function Stepper({ steps, label }: { steps: StepDef[]; label: string }) {
  const focus = steps.find(s => s.state === 'waiting') ?? steps.find(s => s.state === 'failed')
    ?? steps.find(s => s.state === 'current') ?? steps.find(s => s.state === 'todo') ?? steps[steps.length - 1];
  const [open, setOpen] = useState<string | undefined>(focus?.id);
  const [pinned, setPinned] = useState(false);                // the person picked a step: stop following the flow
  const lastFocus = useRef(focus?.id);
  useEffect(() => {
    if (focus?.id === lastFocus.current) return;
    lastFocus.current = focus?.id;
    // A step that needs the person always opens; otherwise only follow the flow until the person picks a step.
    if (focus && (focus.state === 'waiting' || !pinned)) { setOpen(focus.id); setPinned(false); }
  }, [focus, pinned]);
  return (
    <ol aria-label={label} className="grid">
      {steps.map((s, n) => (
        <StepRow key={s.id} step={s} n={n + 1} last={n === steps.length - 1} open={open === s.id}
          onToggle={() => { setPinned(true); setOpen(open === s.id ? undefined : s.id); }} />
      ))}
    </ol>
  );
}

const DOT: Record<StepState, string> = {
  done: 'bg-good text-white border-good',
  current: 'bg-accent text-accent-ink border-accent',
  waiting: 'bg-warn text-white border-warn',
  failed: 'bg-bad text-white border-bad',
  todo: 'bg-surface text-muted border-line',
  off: 'bg-surface-2 text-muted border-line border-dashed',
};

const WORD: Record<StepState, string> = {
  done: 'Done', current: 'In progress', waiting: 'Needs you', failed: 'Stopped', todo: 'Not started', off: 'Switched off',
};

function StepRow({ step, n, last, open, onToggle }: { step: StepDef; n: number; last: boolean; open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    // Bring a step into view only when it opens because it needs the person, and only if it is off screen.
    if (open && !wasOpen.current && step.state === 'waiting' && ref.current) {
      const r = ref.current.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight * 0.6) ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    wasOpen.current = open;
  }, [open, step.state]);
  const bodyId = `step-${step.id}`;
  return (
    <li ref={ref} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
      {!last && <span aria-hidden className={`absolute left-[15px] top-9 bottom-0 w-0.5 ${step.state === 'done' ? 'bg-good/50' : 'bg-line'}`} />}
      <span aria-hidden className={`z-[1] mt-2 grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-semibold tnum ${DOT[step.state]}
        ${step.state === 'current' ? 'ring-4 ring-accent/20' : ''} ${step.state === 'waiting' ? 'animate-pulse' : ''}`}>
        {step.state === 'done' ? '✓' : step.state === 'failed' ? '!' : n}
      </span>
      <div className={`mb-3 rounded-lg border ${open ? 'border-line bg-surface shadow-sm' : 'border-transparent'} ${step.state === 'waiting' ? 'border-warn/70' : ''}`}>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={bodyId}
          className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2/60">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-semibold ${step.state === 'todo' || step.state === 'off' ? 'text-muted' : 'text-ink'}`}>{step.title}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${step.state === 'waiting' ? 'bg-warn/15 text-warn'
                : step.state === 'failed' ? 'bg-bad/15 text-bad' : step.state === 'done' ? 'bg-good/15 text-good'
                : step.state === 'current' ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-muted'}`}>{WORD[step.state]}</span>
            </div>
            {step.summary && <div className="mt-0.5 text-sm text-muted">{step.summary}</div>}
          </div>
          <span aria-hidden className={`mt-1 text-muted transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        </button>
        {open && <div id={bodyId} className="grid gap-4 border-t border-line px-3 py-4">{step.body}</div>}
      </div>
    </li>
  );
}
