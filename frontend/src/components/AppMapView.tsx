import { useMemo, useState } from 'react';
import { GROUPS, NAV, START, edgesOf, groupOf, layout, pathTo, title, type MapElement, type MapPage } from './appmap/graph';

export type { MapElement, MapPage } from './appmap/graph';

const W = 168, H = 54, GX = 96, GY = 18;

export function AppMapView({ pages }: { pages: Record<string, MapPage> }) {
  const edges = useMemo(() => edgesOf(pages), [pages]);
  const keys = useMemo(() => Object.keys(pages), [pages]);
  const { columns } = useMemo(() => layout(keys, edges), [keys, edges]);
  const [selected, setSelected] = useState<string>(() => keys.find(k => pathTo(k, edges).length === 1) ?? keys[0]);

  const pos: Record<string, { x: number; y: number }> = {};
  const tallest = Math.max(...columns.map(c => c.length));
  columns.forEach((col, ci) => col.forEach((k, ri) => {
    const offset = ((tallest - col.length) * (H + GY)) / 2;
    pos[k] = { x: 12 + ci * (W + GX), y: 12 + offset + ri * (H + GY) };
  }));
  const width = 24 + columns.length * W + (columns.length - 1) * GX;
  const height = 24 + tallest * H + (tallest - 1) * GY;
  const inPath = new Set(pathTo(selected, edges).map(e => `${e.from}>${e.to}`));
  const page = pages[selected];
  const elements = page?.elements ?? [];
  const leadsTo = (e: MapElement) => edges.find(x => x.from === selected && e.name && x.label.toLowerCase() === e.name.toLowerCase())?.to
    ?? (e.role === 'link' && e.name ? edges.find(x => x.from === NAV && x.label.toLowerCase() === e.name!.toLowerCase())?.to : undefined);

  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface p-2">
        <svg width={width} height={height} role="img" aria-label="Pages of the app and how to get from one to another" className="block">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
          </defs>
          {edges.map((e, i) => {
            const a = pos[e.from], b = pos[e.to];
            if (!a || !b) return null;
            const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
            const back = x2 <= x1;
            const d = back ? `M${a.x + W / 2},${a.y + H} C${a.x + W / 2},${a.y + H + 40} ${b.x + W / 2},${b.y + H + 40} ${b.x + W / 2},${b.y + H}`
              : `M${x1},${y1} C${x1 + GX / 2},${y1} ${x2 - GX / 2},${y2} ${x2},${y2}`;
            const on = inPath.has(`${e.from}>${e.to}`);
            const lx = back ? (a.x + b.x) / 2 + W / 2 : (x1 + x2) / 2, ly = back ? Math.max(a.y, b.y) + H + 30 : (y1 + y2) / 2 - 4;
            return (
              <g key={i} className={on ? 'text-accent' : 'text-line'}>
                <path d={d} fill="none" stroke="currentColor" strokeWidth={on ? 2.5 : 1.5} markerEnd="url(#arrow)" />
                {e.from !== START && <text x={lx} y={ly} textAnchor="middle" className={`text-[10px] ${on ? 'fill-accent font-semibold' : 'fill-muted'}`}>
                  {e.label.length > 16 ? e.label.slice(0, 15) + '…' : e.label}</text>}
              </g>
            );
          })}
          {[START, ...(edges.some(e => e.from === NAV) ? [NAV] : []), ...keys].map(k => {
            const p = pos[k];
            if (!p) return null;
            const real = k !== START && k !== NAV;
            const els = real ? pages[k].elements ?? [] : [];
            const actions = els.filter(e => groupOf(e) === 'actions').length, fields = els.filter(e => groupOf(e) === 'fields').length;
            const sel = k === selected;
            return (
              <g key={k} transform={`translate(${p.x},${p.y})`} className={real ? 'cursor-pointer' : ''} onClick={() => real && setSelected(k)}
                role={real ? 'button' : undefined} aria-label={real ? `MapPage ${title(k)}` : undefined} tabIndex={real ? 0 : undefined}
                onKeyDown={e => real && (e.key === 'Enter' || e.key === ' ') && setSelected(k)}>
                <rect width={W} height={H} rx={10} className={sel ? 'fill-accent stroke-accent' : real ? 'fill-surface stroke-line' : 'fill-surface-2 stroke-line'}
                  strokeWidth={sel ? 2 : 1} strokeDasharray={real ? undefined : '4 3'} />
                <text x={12} y={22} className={`text-[13px] font-semibold ${sel ? 'fill-accent-ink' : 'fill-ink'}`}>{title(k)}</text>
                <text x={12} y={40} className={`text-[10px] ${sel ? 'fill-accent-ink' : 'fill-muted'}`}>
                  {real ? `${actions} actions · ${fields} fields · ${els.length} in all` : k === START ? 'logged in by the seed' : 'links on every page'}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {page && (
        <div className="grid gap-4 rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold">{title(selected)}</h3>
            {page.address && <a href={page.address} target="_blank" rel="noreferrer" className="font-mono text-sm text-accent hover:underline">{page.address}</a>}
          </div>
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">How to get here</div>
            <ol className="flex flex-wrap items-center gap-1.5 text-sm">
              <li className="rounded-md bg-surface-2 px-2 py-0.5">Start</li>
              {pathTo(selected, edges).map((e, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="text-muted">→</span>
                  {e.from !== START && e.to !== NAV && <span className="rounded-md border border-accent/40 px-2 py-0.5 text-accent">click “{e.label}”</span>}
                  {e.from !== START && e.to !== NAV && <span className="text-muted">→</span>}
                  <button type="button" onClick={() => e.to !== NAV && setSelected(e.to)} className="rounded-md bg-surface-2 px-2 py-0.5 hover:underline">{title(e.to)}</button>
                </li>
              ))}
            </ol>
            {page.reached_by && <p className="mt-1 text-xs text-muted">As the planner wrote it: {page.reached_by}</p>}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[...GROUPS, { id: 'structure', label: 'Headings, regions, lists and dialogs', roles: /./ }].map(g => {
              const list = elements.filter(e => groupOf(e) === g.id);
              if (!list.length) return null;
              return (
                <section key={g.id}>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{g.label} · {list.length}</div>
                  <ul className="grid gap-1">
                    {list.map((e, i) => {
                      const target = leadsTo(e);
                      return (
                        <li key={i} className="flex flex-wrap items-baseline gap-2 text-sm">
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{e.control_type ?? e.role}</span>
                          <span className={e.name ? 'font-medium' : 'text-muted'}>{e.name || e.control_name || '(no name)'}</span>
                          {e.example_text && <span className="text-muted">“{e.example_text}”</span>}
                          {e.test_id && <span className="font-mono text-[11px] text-muted">test id {e.test_id}</span>}
                          {target && <button type="button" onClick={() => setSelected(target)} className="text-xs text-accent hover:underline">opens {title(target)} →</button>}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
