import { describe, expect, it } from 'vitest';
import { parseAnswers, toMarkdown } from './questionnaire';

const QS = [
  { id: 'Q1', test_id: 'TC-41', text: 'Step 6: is this an app bug to report?', recommended: 'yes' },
  { id: 'Q2', test_id: 'TC-42', text: 'Is 5 low?', recommended: 'no, low is below 5' },
  { id: 'Q3', text: 'Anything else we should know?' },
];
const md = toMarkdown(QS, { title: 'Clarify TC-41 and TC-42', run: '2026-10-11-1754', date: '11 Oct 2026' });

describe('toMarkdown', () => {
  it('groups the questions by test case, with the recommended answer and an empty answer line', () => {
    expect(md).toContain('## TC-41\n\n### Q1\nStep 6: is this an app bug to report?\n\nRecommended: yes\n\nAnswer: ');
    expect(md).toContain('## General\n\n### Q3');
    expect(md).toContain('Run: 2026-10-11-1754');
  });
});

describe('parseAnswers', () => {
  it('reads each filled answer, also over several lines, and skips empty ones', () => {
    const filled = md
      .replace('Recommended: yes\n\nAnswer: ', 'Recommended: yes\n\nAnswer: yes, report it')
      .replace('Anything else we should know?\n\nAnswer: ', 'Anything else we should know?\n\nAnswer: The rash note\nshould stay on Ada.');
    expect(parseAnswers(filled, QS)).toEqual({ Q1: 'yes, report it', Q3: 'The rash note\nshould stay on Ada.' });
  });
  it('ignores questions the card does not have and Windows line endings', () => {
    expect(parseAnswers('### Q9\nAnswer: x\r\n### Q2\r\nAnswer: no\r\n', QS)).toEqual({ Q2: 'no' });
  });
});
