import { describe, expect, it } from 'vitest';
import type { StageRow } from '../../api';
import { loginRunning } from '../setup/Login';
import { stageMeta, stageState } from './stages';

const row = (status: string, on = true): StageRow => ({ id: 'clarify', feature: 'x', on, does: '', status, note: '' });

describe('stageState', () => {
  it('maps a stage\'s progress to its place in the stepper', () => {
    expect(['done', 'skipped', 'running', 'failed', 'waiting_for_person', '-'].map(s => stageState(row(s), false)))
      .toEqual(['done', 'done', 'current', 'failed', 'waiting', 'todo']);
  });
  it('shows the running stage as needing the person while a question is open', () => {
    expect(stageState(row('running'), true)).toBe('waiting');
  });
  it('shows a switched-off stage as off, whatever its progress', () => {
    expect(stageState(row('done', false), false)).toBe('off');
  });
  it('names unknown stages from their id', () => {
    expect(stageMeta({ ...row('-'), id: 'new_stage', does: 'Does it.' })).toEqual({ title: 'new stage', about: 'Does it.' });
  });
});

describe('loginRunning', () => {
  const e = (type: string, extra: object = {}) => ({ seq: 0, ts: 0, type, ...extra });
  it('is running from the login agent\'s start until it ends, fails or is stopped', () => {
    const start = e('agent_start', { agent: 'uat-login-setup' });
    expect(loginRunning([start])).toBe(true);
    expect(loginRunning([start, e('agent_end', { agent: 'uat-login-setup' })])).toBe(false);
    expect(loginRunning([start, e('agent_error', { stage: 'setup-login' })])).toBe(false);
    expect(loginRunning([start, e('note', { text: 'Login setup stopped.' })])).toBe(false);
    expect(loginRunning([start, e('agent_end', { agent: 'playwright-test-planner' })])).toBe(true);
  });
});
