import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { NewRunPanel } from '../components/runs/NewRunPanel';
import { RunCard } from '../components/runs/RunCard';
import { useRuns } from '../lib/queries';
import { Button, Empty, QueryGate, useTitle } from '../ui';

/** Every run of this project, newest first, each with its own Excel, progress and results. */
export function RunsPage() {
  useTitle('Test runs');
  const runs = useRuns();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');   // the dashboard's "New run" opens it here
  const close = () => { setOpen(false); if (params.has('new')) setParams({}, { replace: true }); };
  const list = runs.data ?? [];
  return (
    <div className="mx-auto grid max-w-5xl gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Test runs</h1>
          <p className="text-sm text-muted">Each run takes one Excel of test cases to tested evidence and a signed-off results.xlsx.</p>
        </div>
        {!open && <Button kind="primary" onClick={() => setOpen(true)}>New run</Button>}
      </div>
      {open && <NewRunPanel onClose={close} />}
      <QueryGate pending={runs.isPending} error={runs.isError ? runs.error : null} label="Loading runs…">
        {list.length
          ? <div className="grid gap-3">{list.map(r => <RunCard key={r.id} run={r} />)}</div>
          : <Empty>No runs yet. Start one with New run.</Empty>}
      </QueryGate>
    </div>
  );
}
