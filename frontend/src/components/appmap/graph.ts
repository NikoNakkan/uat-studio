// The app map as a graph: pages, the clicks that lead from one to another, their columns, and the path from the
// start to any page. Pure functions, no drawing (see AppMapView).

export type MapElement = { role?: string; name?: string; example_text?: string; test_id?: string; control_name?: string; control_type?: string };
export type MapPage = { address?: string; reached_by?: string; ready_control?: string; elements?: MapElement[] };
export type Edge = { from: string; to: string; label: string };

export const START = '__start';
export const NAV = '__nav';
export const title = (key: string) => key === START ? 'Start' : key === NAV ? 'Side navigation' : key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

/**
 * How pages connect, read from each page's "reached_by" (written by Playwright's planner):
 *  "click the link "Billing" on the Today page"  -> Today --"Billing"--> Billing
 *  "the "Labs" link in the side navigation"       -> Side navigation --"Labs"--> Labs
 *  "start page ..." with no other way in           -> Start --> page
 */
export function edgesOf(pages: Record<string, MapPage>): Edge[] {
  const keys = Object.keys(pages);
  const byName = (s: string) => keys.find(k => k.toLowerCase() === s.toLowerCase().replace(/\s+/g, '_') || title(k).toLowerCase() === s.toLowerCase());
  const edges: Edge[] = [];
  for (const [to, p] of Object.entries(pages)) {
    const text = p.reached_by ?? '';
    for (const part of text.split(/;|\balso\b/)) {
      const on = part.match(/(?:click|press|open)[^"]*"([^"]+)"[^]*?\bon the ([\w\s-]+?) page/i);
      if (on) {
        const from = byName(on[2].trim());
        if (from && from !== to) edges.push({ from, to, label: on[1] });
        continue;
      }
      const nav = part.match(/"([^"]+)"[^"]*side navigation/i);
      if (nav) edges.push({ from: NAV, to, label: nav[1] });
    }
    const root = (() => { try { return new URL(p.address ?? '').pathname === '/'; } catch { return false; } })();
    if (root || (/start page/i.test(text) && !edges.some(e => e.to === to))) edges.push({ from: START, to, label: root ? 'after login' : 'open the address' });
  }
  if (edges.some(e => e.from === NAV)) {
    const home = keys.find(k => { try { return new URL(pages[k].address ?? '').pathname === '/'; } catch { return false; } });
    edges.push({ from: home ?? START, to: NAV, label: 'on every page' });
  }
  return edges;
}

/** Columns by distance from Start (breadth first); pages nothing leads to go in the last column. */
export function layout(keys: string[], edges: Edge[]) {
  const depth: Record<string, number> = { [START]: 0 };
  const queue = [START];
  while (queue.length) {
    const k = queue.shift()!;
    for (const e of edges.filter(x => x.from === k)) {
      if (depth[e.to] === undefined) { depth[e.to] = depth[k] + 1; queue.push(e.to); }
    }
  }
  const max = Math.max(0, ...Object.values(depth));
  for (const k of keys) if (depth[k] === undefined) depth[k] = max + 1;
  const columns: string[][] = [];
  for (const [k, d] of Object.entries(depth)) (columns[d] ??= []).push(k);
  return { depth, columns: columns.map(c => c ?? []) };
}

/** The path from Start to a page, as the clicks a person makes. */
export function pathTo(target: string, edges: Edge[]): Edge[] {
  const prev: Record<string, Edge> = {};
  const seen = new Set([START]);
  const queue = [START];
  while (queue.length) {
    const k = queue.shift()!;
    if (k === target) break;
    for (const e of edges.filter(x => x.from === k)) {
      if (!seen.has(e.to)) { seen.add(e.to); prev[e.to] = e; queue.push(e.to); }
    }
  }
  const out: Edge[] = [];
  for (let k = target; prev[k]; k = prev[k].from) out.unshift(prev[k]);
  return out;
}

export const GROUPS: { id: string; label: string; roles: RegExp }[] = [
  { id: 'actions', label: 'Buttons and links', roles: /^(button|link|menuitem|tab|checkbox|radio|switch|option)$/ },
  { id: 'fields', label: 'Fields', roles: /^(textbox|combobox|spinbutton|searchbox|textarea|slider|listbox)$/ },
  { id: 'messages', label: 'Messages and values seen', roles: /^(status|alert|paragraph|generic|cell|listitem|text|note|log)$/ },
];
export const groupOf = (e: MapElement) => GROUPS.find(g => g.roles.test(e.role ?? ''))?.id ?? 'structure';
