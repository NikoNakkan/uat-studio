import type { RunDetail } from '../../api';
import type { RunData } from '../../types/run';
import { Card, Empty, Pill, Pre, Table } from '../../ui';

/** The run's test cases as read from the Excel, with their clarification state. */
export function CasesView({ d }: { d: RunData }) {
  const cases = d.cases ?? [];
  if (!cases.length) return <Empty>The Excel has not been read yet.</Empty>;
  return (
    <Card title={`${cases.length} test cases`}>
      {d.studio_validation?.output && <Pre className="mb-3 text-bad">{d.studio_validation.output}</Pre>}
      <Table resize={[12, 12, 14, 13, 16, 15, 18]} head={['Test ID', 'Group', 'Title', 'Login as', 'Steps', 'Expected results', 'State']} rows={cases.map(c => [
        <span className="font-mono">{c.test_id}</span>, c.group, c.title, c.login_as || '—',
        <ol className="list-decimal pl-4">{c.steps.map(s => <li key={s.n}>{s.text}</li>)}</ol>,
        <ul>{c.expected_results.map((e, i) => <li key={i}><span className="text-muted tnum">{e.step}.</span> {e.text}</li>)}</ul>,
        <div className="flex min-w-0 max-w-full flex-wrap gap-1 [&_span]:max-w-full [&_span]:min-w-0 [&_span]:whitespace-normal">
          {String(c.automation || '').toLowerCase() === 'manual' && <Pill value="MANUAL" label="manual" />}
          {c.clarified && <Pill value="done" label="clarified" />}
          {c.open_questions && <Pill value="waiting" label="open questions" />}
          {c.carried_from && <Pill value="-" label={`carried from ${c.carried_from}`} />}
        </div>,
      ])} />
    </Card>
  );
}

const NOTES = ['clarifications.md', 'questionnaire.md', 'mismatches.md', 'excel-updates.md'] as const;

/** What changed since the last run, and the questions asked and answered about the cases. */
export function ChangesView({ r }: { r: RunDetail }) {
  const changes = r.data.changes?.cases ?? {};
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Changes since the last run">
        {Object.keys(changes).length ? <Table head={['Test ID', 'Status', 'Decision', 'Details']} rows={Object.entries(changes).map(([id, c]) => [
          <span className="font-mono">{id}</span>, c.status, c.decision ?? <span className="text-warn">to confirm</span>,
          [c.fields_changed?.join(', '), c.wording_only_candidate ? 'wording only?' : '', c.similar_to ? `similar to ${c.similar_to}` : ''].filter(Boolean).join(' · '),
        ])} /> : <Empty>No comparison yet.</Empty>}
      </Card>
      <div className="grid gap-4">
        {NOTES.map(n => r.texts[n] && <Card key={n} title={n}><Pre>{r.texts[n]}</Pre></Card>)}
        {!r.texts['clarifications.md'] && <Card title="Clarifications"><Empty>No questions asked yet.</Empty></Card>}
      </div>
    </div>
  );
}
