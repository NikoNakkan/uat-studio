import type { ReactNode } from 'react';
import type { RunDetail } from '../../api';
import { Card, Pre } from '../../ui';
import { Signoff } from '../Signoff';
import { VisualRegression } from '../VisualRegression';
import { CasesView, ChangesView } from './CasesView';
import { ResultsView } from './ResultsView';
import { FailuresView } from './RunDetails';
import { GeneratedView, TestsView } from './TestsView';

/** What a stage produced, shown inside its step; null while it has produced nothing yet. */
export function stageOutput(id: string, runId: string, r: RunDetail, visual: { focus: string | null; setFocus: (id: string | null) => void }): ReactNode {
  const d = r.data;
  switch (id) {
    case 'intake': return d.cases ? <CasesView d={d} /> : null;
    case 'clarify': return d.cases ? <ChangesView r={r} /> : null;
    case 'planner_check': return r.texts['mismatches.md'] ? <Card title="Mismatches"><Pre>{r.texts['mismatches.md']}</Pre></Card> : null;
    case 'generate': return d.generate_list?.length ? <GeneratedView d={d} /> : null;
    case 'test_check': return d.test_check ? <TestsView d={d} /> : null;
    case 'run': return Object.keys(d.progress?.tests ?? {}).length ? <ResultsView runId={runId} r={r} onVisual={visual.setFocus} /> : null;
    case 'failures': return d.diagnoses ? <FailuresView r={r} /> : null;
    case 'screens': return d.screens ? <>
      {visual.focus && <p className="text-sm">Showing {visual.focus} only · <button className="text-link hover:underline" onClick={() => visual.setFocus(null)}>show every test</button></p>}
      <VisualRegression runId={runId} focus={visual.focus} />
    </> : null;
    case 'signoff': return d.evidence_check ? <Signoff runId={runId} r={r} /> : null;
    default: return null;
  }
}
