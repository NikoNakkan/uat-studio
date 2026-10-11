import { useState } from 'react';
import { useKitText } from '../../lib/queries';
import type { RunData } from '../../types/run';
import { Card, Empty, Pill, Pre, QueryGate, Table } from '../../ui';

/** The test check's verdict per test file, how stable each new test was, and the code of any test. */
export function TestsView({ d }: { d: RunData }) {
  const [open, setOpen] = useState<string | null>(null);
  const file = useKitText(open);
  const checks = d.test_check?.files ?? {};
  const flaky = d.flakiness ?? {};
  const generated = d.generate_list ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title="Test check">
        {Object.keys(checks).length ? <Table head={['Test file', 'Verdict', 'Stable', 'Problems']} rows={Object.entries(checks).map(([path, c]) => [
          <button className="font-mono text-left text-link hover:underline" onClick={() => setOpen(path)}>{path}</button>,
          <Pill value={c.ok ? 'ACCEPT' : 'REJECT'} />,
          flaky[c.test_id] ? <Pill value={flaky[c.test_id].verdict} label={`${flaky[c.test_id].passed}/${flaky[c.test_id].runs}`} /> : '—',
          <ul className="text-xs">{c.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>,
        ])} /> : <Empty>No tests checked yet.</Empty>}
        {generated.length > 0 && <p className="mt-3 text-xs text-muted">Generated in this run: {generated.map(g => g.test_id).join(', ')}</p>}
      </Card>
      <Card title={open ?? 'Test code'}>
        {!open ? <Empty>Pick a test file to read it.</Empty>
          : <QueryGate pending={file.isPending} error={file.isError ? file.error : null} label="Loading test code…">
              <Pre className="max-h-[70vh] overflow-y-auto">{file.data?.text}</Pre>
            </QueryGate>}
      </Card>
    </div>
  );
}

/** The tests the generator wrote in this run, each opening its code. */
export function GeneratedView({ d }: { d: RunData }) {
  const [open, setOpen] = useState<string | null>(null);
  const file = useKitText(open);
  const written = d.generate_list ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title={`Tests written in this run · ${written.length}`}>
        <Table head={['Test', 'File']} rows={written.map(g => [
          <span><b className="font-mono">{g.test_id}</b> <span className="text-muted">{(g.test_name ?? '').replace(g.test_id, '').trim()}</span></span>,
          g.test_file ? <button className="font-mono text-left text-xs text-link hover:underline" onClick={() => setOpen(g.test_file ?? null)}>{g.test_file}</button> : '—',
        ])} />
        <p className="mt-3 text-xs text-muted">The other cases reuse the tests written in earlier runs.</p>
      </Card>
      <Card title={open ?? 'Test code'}>
        {!open ? <Empty>Pick a test to read its code.</Empty>
          : <QueryGate pending={file.isPending} error={file.isError ? file.error : null} label="Loading test code…">
              <Pre className="max-h-[70vh] overflow-y-auto">{file.data?.text}</Pre>
            </QueryGate>}
      </Card>
    </div>
  );
}
