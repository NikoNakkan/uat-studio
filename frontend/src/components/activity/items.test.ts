import { describe, expect, it } from 'vitest';
import type { Event } from '../../api';
import { inStage, toItems } from './items';

let seq = 0;
const ev = (type: string, extra: Partial<Event> = {}): Event => ({ seq: ++seq, ts: 0, type, ...extra });

describe('toItems', () => {
  it('pairs each tool call with its result, in order, per agent and tool', () => {
    const items = toItems([
      ev('tool_call', { agent: 'a', tool: 'browser_click', input: '{"element":"Save"}' }),
      ev('tool_call', { agent: 'a', tool: 'browser_click', input: '{"element":"Close"}' }),
      ev('tool_result', { agent: 'a', tool: 'browser_click', text: 'first' }),
      ev('tool_result', { agent: 'a', tool: 'browser_click', text: 'second' }),
    ]);
    expect(items.map(i => (i.kind === 'tool' ? i.result?.text : null))).toEqual(['first', 'second']);
  });

  it('groups a script with its lines and its end', () => {
    const [item] = toItems([ev('script_start', { script: 'check_login' }), ev('script_line', { text: 'OK' }), ev('script_end', { code: 0 })]);
    expect(item.kind).toBe('script');
    if (item.kind === 'script') expect([item.lines, item.end?.code]).toEqual([['OK'], 0]);
  });

  it('leaves the person\'s questions out of the steps (they show as bubbles)', () => {
    expect(toItems([ev('tool_call', { tool: 'ask_person' }), ev('tool_result', { tool: 'ask_person' })])).toEqual([]);
  });

  it('closes open work when the run is stopped, so nothing spins forever', () => {
    const items = toItems([
      ev('script_start', { script: 'run_tests' }), ev('tool_call', { agent: 'a', tool: 'browser_click' }),
      ev('run', { status: 'stopped', reason: 'Stopped by the person.' }),
    ]);
    const script = items.find(i => i.kind === 'script');
    const tool = items.find(i => i.kind === 'tool');
    expect(script?.kind === 'script' && script.end?.code).toBe(130);
    expect(tool?.kind === 'tool' && tool.result?.is_error).toBe(true);
  });
});

describe('inStage', () => {
  it('gives questions and answers (no stage) to the stage that was running', () => {
    const events = [ev('stage', { stage: 'clarify' }), ev('waiting'), ev('answered'), ev('stage', { stage: 'plan' }), ev('note')];
    expect(inStage(events, 'clarify').map(e => e.type)).toEqual(['stage', 'waiting', 'answered']);
    expect(inStage(events, 'plan').map(e => e.type)).toEqual(['stage', 'note']);
  });
});
