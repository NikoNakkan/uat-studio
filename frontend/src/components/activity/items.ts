// Live events turned into a conversation: tool calls paired with their results, script output grouped per
// script, everything else kept as it came.
import type { Event } from '../../api';

/** A stage's events. Questions and answers carry no stage: they belong to the stage that was running then. */
export function inStage(events: Event[], stage: string): Event[] {
  let current: string | undefined;
  return events.filter(e => {
    if (e.stage) current = e.stage;
    return (e.stage ?? current) === stage;
  });
}

export type Item =
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

export function toItems(events: Event[]): Item[] {
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
