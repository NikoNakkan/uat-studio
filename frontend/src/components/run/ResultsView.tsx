import { useState } from 'react';
import type { RunDetail } from '../../api';
import { Button, Card, Empty, Pill, Table } from '../../ui';
import { TestEvidence, isProblem } from '../Evidence';

/** Every test's result and evidence; tests that did not pass come first, each opens its evidence in place. */
export function ResultsView({ runId, r, onVisual }: { runId: string; r: RunDetail; onVisual: (id: string) => void }) {
  const d = r.data;
  const tests = d.progress?.tests ?? {};
  const check = d.evidence_check?.tests ?? {};
  const [open, setOpen] = useState<string | null>(null);
  const titleOf = (id: string) => d.cases?.find(c => c.test_id === id)?.title ?? '';
  const screensOf = (id: string) => (d.screens?.pairs ?? d.screens?.flagged ?? []).filter(p => p.test_id === id);
  const ids = Array.from(new Set([...Object.keys(tests), ...Object.keys(check)]))
    .sort((a, b) => Number(isProblem(tests[b]?.result)) - Number(isProblem(tests[a]?.result)) || a.localeCompare(b, undefined, { numeric: true }));
  if (!ids.length) return <Empty>No results yet.</Empty>;
  const problems = ids.filter(id => isProblem(tests[id]?.result)).length;

  return (
    <Card title={`Results and evidence · ${ids.length} tests${problems ? ` · ${problems} to look at` : ''}`}>
      <Table
        head={['Test', 'Result', 'Recommendation', 'Screenshots', 'Visual', 'Why / missing', '']}
        rowClass={i => `${isProblem(tests[ids[i]]?.result) ? 'bg-bad/5' : ''} ${open === ids[i] ? 'bg-accent/5' : ''}`}
        rows={ids.map(id => {
          const screens = screensOf(id);
          const changed = screens.filter(p => p.status === 'changed' || p.changed_pixels).length;
          return [
            <div className="whitespace-nowrap"><span className="font-mono">{id}</span>
              <div className="max-w-56 truncate text-xs text-muted" title={titleOf(id)}>{titleOf(id)}</div></div>,
            <Pill value={tests[id]?.result ?? check[id]?.result ?? '-'} />,
            check[id] ? <Pill value={check[id].recommendation} /> : '—',
            <span className="whitespace-nowrap tnum">{check[id]?.screenshots ?? '—'}</span>,
            screens.length ? <button className="whitespace-nowrap text-link hover:underline" onClick={() => onVisual(id)}>{changed} changed of {screens.length}</button> : '—',
            <span className="block min-w-48 max-w-md text-xs [overflow-wrap:anywhere]">{[...(check[id]?.reasons ?? []), ...(check[id]?.missing ?? []), tests[id]?.error].filter(Boolean).join('; ')}</span>,
            tests[id]?.result
              ? <Button kind={isProblem(tests[id].result) ? 'primary' : 'default'} onClick={() => setOpen(open === id ? null : id)}>{open === id ? 'Hide' : 'Evidence'}</Button>
              : null,
          ];
        })}
        details={ids.map(id => (open === id ? <TestEvidence runId={runId} r={r} testId={id} /> : null))}
      />
    </Card>
  );
}
