import { describe, expect, it } from 'vitest';
import { unread } from './Live';

const at = (type: string, seconds: number) => ({ seq: seconds, ts: seconds, type });

describe('unread', () => {
  const seenAt = 1_000_000;                                  // ms: the person last looked at 1000 s
  it('counts only what arrived after the person last looked, so replayed history never counts again', () => {
    expect(unread([at('agent_text', 900), at('agent_text', 999)], seenAt).count).toBe(0);
    expect(unread([at('agent_text', 900), at('agent_text', 1001)], seenAt).count).toBe(1);
  });
  it('counts messages, questions and stages, not every tool step', () => {
    expect(unread([at('tool_call', 1001), at('tool_result', 1002), at('script_line', 1003), at('stage', 1004)], seenAt).count).toBe(1);
  });
  it('flags a waiting question', () => {
    expect(unread([at('waiting', 1001)], seenAt)).toEqual({ count: 1, question: true });
  });
});
