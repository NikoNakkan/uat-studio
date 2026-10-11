import { useRef, useState } from 'react';
import type { Interaction } from '../../api';
import { download, parseAnswers, toMarkdown } from '../../lib/questionnaire';
import { Button, inputCls } from '../../ui';

/**
 * The clarifier's questions, answered in place. When the Excel's author has the answers, export them as a
 * Markdown questionnaire, send it, and import the filled file back: it fills the answers here (no AI call), and
 * Send answers goes on as usual. The question stays open, and the run waits, until then.
 */
export function Questions({ item, busy, send }: { item: Interaction; busy: string | null; send: (r: unknown) => void }) {
  const qs = item.payload.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(qs.map(q => [q.id, q.recommended ?? ''])));
  const [note, setNote] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const exportMd = () => {
    const date = new Date().toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    download(`questionnaire-${item.channel}.md`, toMarkdown(qs, { title: item.title, run: item.channel, date }));
    setNote('Questionnaire saved. Send it to the author; the run waits here until you send the answers.');
  };
  const importMd = async (f: File | undefined) => {
    if (!f) return;
    const got = parseAnswers(await f.text(), qs);
    const n = Object.keys(got).length;
    setAnswers(a => ({ ...a, ...got }));
    setNote(n ? `Filled ${n} answer${n === 1 ? '' : 's'} from ${f.name}. Check them, then Send answers.`
      : `No answers found in ${f.name}: each answer goes after "Answer:" under its question.`);
    if (file.current) file.current.value = '';
  };
  return (
    <form className="grid gap-3" onSubmit={e => { e.preventDefault(); send(answers); }}>
      {qs.map(q => (
        <div key={q.id} className="grid gap-1 text-sm">
          <label htmlFor={`q-${item.id}-${q.id}`}><b className="tnum">{q.id}.</b> {q.test_id && /\d/.test(q.test_id) ? <span className="font-mono text-xs text-muted">{q.test_id} · </span> : null}{q.text}</label>
          {q.recommended && <span className="text-xs text-muted">Recommended: {q.recommended}</span>}
          <input id={`q-${item.id}-${q.id}`} className={inputCls} disabled={!!busy} value={answers[q.id] ?? ''}
            onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" kind="primary" busy={busy === 'answers'} disabled={!!busy}>{busy === 'answers' ? 'Sending…' : 'Send answers'}</Button>
        <Button disabled={!!busy} onClick={exportMd} title="A Markdown file with these questions to send to the Excel's author">Export questionnaire (.md)</Button>
        <Button disabled={!!busy} onClick={() => file.current?.click()} title="Fill the answers from a completed questionnaire">Import answers (.md)</Button>
        <input ref={file} type="file" accept=".md,.txt,text/markdown,text/plain" className="hidden" onChange={e => importMd(e.target.files?.[0])} />
      </div>
      {note && <p className="text-xs text-muted" role="status">{note}</p>}
    </form>
  );
}
