import { useLayoutEffect, useState, type RefObject } from 'react';

/** A place where the flow goes back to an earlier step, and how often this run went round it. */
export type StepLoop = { from: string; to: string; label: string; count: number };

type Arc = StepLoop & { top: number; bottom: number; x: number };
export const LOOP_GUTTER = 44;          // px of room left of the step circles for the arcs

/**
 * Dashed arcs left of the step circles, from a later step back up to the one it returns to, with an arrow
 * into the earlier step. Faint until the run actually went round; then in the accent colour with the count.
 * Positions are measured from the circles (data-step-dot), and again whenever a step opens or closes.
 */
export function StepLoops({ loops, list }: { loops: StepLoop[]; list: RefObject<HTMLOListElement | null> }) {
  const [arcs, setArcs] = useState<Arc[]>([]);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => {
      const base = el.getBoundingClientRect().top;
      const mid = (id: string) => {
        const dot = el.querySelector(`[data-step-dot="${id}"]`);
        if (!dot) return null;
        const r = dot.getBoundingClientRect();
        return r.top - base + r.height / 2;
      };
      setArcs(loops.flatMap((l, i) => {
        const bottom = mid(l.from), top = mid(l.to);
        return bottom === null || top === null ? [] : [{ ...l, top, bottom, x: 10 + (i % 2) * 12 }];
      }));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [loops, list]);

  return (
    <svg aria-hidden className="pointer-events-none absolute left-0 top-0 h-full overflow-visible" width={LOOP_GUTTER}>
      <defs>
        {(['went', 'idle'] as const).map(k => (
          <marker key={k} id={`loop-arrow-${k}`} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={k === 'went' ? 'var(--accent)' : 'var(--line)'} />
          </marker>
        ))}
      </defs>
      {arcs.map(a => {
        const went = a.count > 0;
        const r = 8, end = LOOP_GUTTER;          // the circles start right after the gutter
        return (
          <g key={`${a.from}-${a.to}`} className={went ? 'text-accent' : 'text-line'}>
            <title>{a.label}{went ? ` (went back ${a.count}×)` : ''}</title>
            <path d={`M ${end} ${a.bottom} H ${a.x + r} Q ${a.x} ${a.bottom} ${a.x} ${a.bottom - r} V ${a.top + r} Q ${a.x} ${a.top} ${a.x + r} ${a.top} H ${end - 2}`}
              fill="none" stroke="currentColor" strokeWidth={went ? 2 : 1.5} strokeDasharray="5 4" markerEnd={`url(#loop-arrow-${went ? 'went' : 'idle'})`} />
            {went && (
              // Inside the loop, between the dashed line and the circles, level: it never meets a line, even when the
              // two steps are neighbours and the arc is short. The full wording is in the title above.
              <text x={(a.x + end) / 2 + 1} y={(a.top + a.bottom) / 2} fill="currentColor" fontSize="12" fontWeight="700"
                dominantBaseline="central" textAnchor="middle">{a.count}×</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** The loops in words, for screen readers (the arcs themselves are decoration). */
export function loopsText(loops: StepLoop[], title: (id: string) => string): string {
  return loops.map(l => `${l.label}: from ${title(l.from)} back to ${title(l.to)}${l.count ? `, ${l.count} time${l.count === 1 ? '' : 's'} in this run` : ''}.`).join(' ');
}
