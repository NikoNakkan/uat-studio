// The clarifier's open questions as a Markdown questionnaire for the Excel's author, and their answers read back.
// Built from the questions already on screen: no AI call either way.

export type Question = { id: string; test_id?: string; text: string; recommended?: string };

const HOW = 'Write your answer after "Answer:" under each question and send the file back. '
  + 'Leave an answer empty to accept the recommended one. Please keep the headings as they are.';

/** The questionnaire, grouped by test case, each question with its recommended answer and room for the reply. */
export function toMarkdown(questions: Question[], about: { title: string; run: string; date: string }): string {
  const groups = new Map<string, Question[]>();
  for (const q of questions) {
    const key = q.test_id && /\d/.test(q.test_id) ? q.test_id : 'General';
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  const lines = [`# Questions about your UAT test cases`, '', `Run: ${about.run} · ${about.date}`, `About: ${about.title}`, '', HOW, ''];
  for (const [testId, qs] of groups) {
    lines.push(`## ${testId}`, '');
    for (const q of qs) {
      lines.push(`### ${q.id}`, q.text, '');
      if (q.recommended) lines.push(`Recommended: ${q.recommended}`, '');
      lines.push('Answer: ', '');
    }
  }
  return lines.join('\n');
}

/**
 * The answers written into a returned questionnaire, by question id. An answer may run over several lines; it
 * ends at the next heading. Empty answers are left out, so the card keeps what it had (the recommended answer).
 */
export function parseAnswers(markdown: string, questions: Question[]): Record<string, string> {
  const ids = new Set(questions.map(q => q.id));
  const out: Record<string, string> = {};
  const blocks = markdown.replace(/\r\n/g, '\n').split(/^###\s+/m).slice(1);
  for (const block of blocks) {
    const id = block.split('\n', 1)[0].trim();
    if (!ids.has(id)) continue;
    const m = /^Answer:[ \t]*([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/m.exec(block);
    const answer = (m?.[1] ?? '').trim();
    if (answer) out[id] = answer;
  }
  return out;
}

/** Offer a text file to save, the way any web app downloads one. */
export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
