import type { StageRow } from '../../api';
import type { StepState } from '../Stepper';

/** What each stage is called and what it is for, in words a test author uses. */
export const STAGES: Record<string, { title: string; about: string }> = {
  preflight: { title: 'Check the setup', about: 'Machine, app under test and login are ready.' },
  intake: { title: 'Read the Excel', about: 'Reads every case and checks it follows the template.' },
  clarify: { title: 'Clarify the cases', about: 'Asks you about anything vague, so no expected value is invented.' },
  plan: { title: 'Write the plan', about: 'Turns the cases into Playwright plans and proves the accounts log in.' },
  planner_check: { title: 'Check steps in the live app', about: 'Playwright tries each step in your app and records the real names on screen.' },
  generate: { title: 'Write the tests', about: 'One Playwright test per new or changed case, written in the live app.' },
  test_check: { title: 'Check the tests', about: 'Each test must match its Excel row exactly, and pass three times in a row.' },
  run: { title: 'Run the tests', about: 'Plain Playwright, no AI: screenshots per step, a trace and the console.' },
  console_review: { title: 'Console and network errors', about: 'New errors since the last run, explained.' },
  failures: { title: 'Explain failures', about: 'Each failure is reproduced and called a bug, a broken test or the environment.' },
  screens: { title: 'Compare screens', about: 'Screenshots against the last accepted run.' },
  signoff: { title: 'Sign off', about: 'You decide each result, with the evidence next to it.' },
};

export const stageMeta = (s: StageRow) => STAGES[s.id] ?? { title: s.id.replace(/_/g, ' '), about: s.does };

/** A stage's place in the stepper. `waiting`: the run is at this stage and a question is open. */
export function stageState(s: StageRow, waiting: boolean): StepState {
  if (!s.on) return 'off';
  if (s.status === 'waiting_for_person' || waiting) return 'waiting';
  if (s.status === 'running') return 'current';
  if (s.status === 'failed') return 'failed';
  if (s.status === 'done' || s.status === 'skipped') return 'done';
  return 'todo';
}
