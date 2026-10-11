import { Fragment, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

const MIN_COL = 56;   // px a column keeps when its neighbour is widened

function columnFractions(resize: boolean | number[] | undefined, n: number): number[] | null {
  if (!resize) return null;
  const weights = Array.isArray(resize) && resize.length === n ? resize : Array.from({ length: n }, () => 1);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map(w => w / sum);
}

/** Moves the border between column i and i+1 by px, keeping both at least MIN_COL wide. */
function shiftBorder(fracs: number[], i: number, px: number, width: number): number[] {
  if (i + 1 >= fracs.length) return fracs;
  const min = MIN_COL / width;
  const delta = Math.max(-(fracs[i] - min), Math.min(fracs[i + 1] - min, px / width));
  const next = fracs.slice();
  next[i] += delta;
  next[i + 1] -= delta;
  return next;
}

/**
 * A table. `details[i]`, when given, is shown as a full-width row under row i (evidence under a test, for
 * example), so pages never hand-build a table for that. `resize` lets the person drag (or arrow-key) a header
 * border to share width with the next column; its numbers are the starting share of each column.
 */
export function Table({ head, rows, details, resize, rowClass }: {
  head: ReactNode[];
  rows: ReactNode[][];
  details?: (ReactNode | null | undefined)[];
  resize?: boolean | number[];
  rowClass?: (i: number) => string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; x: number; fracs: number[]; width: number } | null>(null);
  const [fracs, setFracs] = useState<number[] | null>(() => columnFractions(resize, head.length));
  const width = () => scroller.current?.clientWidth || 1;

  const body = rows.map((r, i) => (
    <Fragment key={i}>
      <tr className={`border-b border-line/60 align-top hover:bg-surface-2/50 ${rowClass?.(i) ?? ''}`}>
        {r.map((c, j) => <td key={j} className={fracs ? 'px-1.5 py-1.5 break-words [overflow-wrap:anywhere]' : 'px-2 py-1.5'}>{c}</td>)}
      </tr>
      {details?.[i] && <tr><td colSpan={head.length} className="px-2 pb-3">{details[i]}</td></tr>}
    </Fragment>
  ));

  if (!fracs) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-muted">{head.map((h, i) => <th key={i} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>{body}</tbody>
        </table>
      </div>
    );
  }

  const onPointerDown = (i: number, e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { i, x: e.clientX, fracs, width: width() };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (d) setFracs(shiftBorder(d.fracs, d.i, e.clientX - d.x, d.width));
  };
  const endDrag = () => { drag.current = null; };

  return (
    <div ref={scroller} className="min-w-0 overflow-x-clip">
      <table className="w-full table-fixed text-sm">
        <colgroup>{fracs.map((f, i) => <col key={i} style={{ width: `${f * 100}%` }} />)}</colgroup>
        <thead><tr className="border-b border-line text-left text-xs text-muted">{head.map((h, i) => (
          <th key={i} className="relative px-1.5 py-1.5 font-medium break-words">
            {h}
            {i < head.length - 1 && (
              <span role="separator" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fracs[i] * 100)}
                aria-label={typeof h === 'string' ? `Resize ${h}` : `Resize column ${i + 1}`} title="Drag to resize" tabIndex={0}
                className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-accent/40"
                onPointerDown={e => onPointerDown(i, e)} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
                onKeyDown={e => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  setFracs(prev => prev && shiftBorder(prev, i, e.key === 'ArrowLeft' ? -16 : 16, width()));
                }} />
            )}
          </th>
        ))}</tr></thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}
