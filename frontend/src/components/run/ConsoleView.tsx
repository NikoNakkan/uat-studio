import { useState } from 'react';
import { api, type RunDetail } from '../../api';
import { useAction } from '../../lib/useAction';
import type { ConsoleGroup } from '../../types/run';
import { Button, Card, Empty, Pre, Table, inputCls } from '../../ui';

/** New console and network errors since the last run, and the console analyst's explanation. */
export function ConsoleView({ r }: { r: RunDetail }) {
  const c = r.data.console_new;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={c ? `${c.groups.length} new error group(s) · ${c.captured} captured · ${c.ignored_as_noise} known noise` : 'Console and network errors'}>
        {c?.groups.length ? <Table head={['Message', 'Kind', 'Where', 'In a failing test', '']} rows={c.groups.map(g => [
          <span className="font-mono text-xs">{g.message}</span>, g.kind, g.where.map(w => `${w.test_id} (${w.step})`).join(', '),
          g.in_failing_test ? 'yes' : 'hidden in passing tests', <NoiseButton group={g} />,
        ])} /> : <Empty>No new errors.</Empty>}
        <p className="mt-3 text-xs text-muted">Marking a message as known noise adds it to config/console-noise.yaml; future runs stop reporting it. Only a person does this.</p>
      </Card>
      <Card title="Console analyst (console.md)">{r.texts['console.md'] ? <Pre>{r.texts['console.md']}</Pre> : <Empty>No review yet.</Empty>}</Card>
    </div>
  );
}

const isNetwork = (g: ConsoleGroup) => g.kind !== 'console' && g.kind !== 'page error';

/** A person accepts one error group as harmless noise (decision 31: the analyst only proposes). */
function NoiseButton({ group }: { group: ConsoleGroup }) {
  const network = isNetwork(group);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState(false);
  // "404 /favicon.ico" is matched by its path; a console message by its text.
  const [pattern, setPattern] = useState(network ? group.message.split(' ')[1] ?? group.message : group.message.replace(/#/g, '').slice(0, 120));
  const { busy, error, run } = useAction();
  const add = () => run('add', async () => {
    const code = group.message.match(/^(\d{3}) /)?.[1];
    await api.post('/api/kit/console-noise', { kind: network ? 'network' : 'console', pattern, reason, status: network && code ? [Number(code)] : [] });
    setSaved(true);
  });
  if (saved) return <span className="text-xs text-good">Added to known noise</span>;
  if (!open) return <Button kind="ghost" onClick={() => setOpen(true)}>Known harmless…</Button>;
  return (
    <div className="grid min-w-56 gap-1.5">
      <input className={inputCls} aria-label="Text to match" value={pattern} onChange={e => setPattern(e.target.value)} />
      <input className={inputCls} placeholder="Why it is harmless (required)" value={reason} onChange={e => setReason(e.target.value)} />
      <div className="flex gap-1.5">
        <Button kind="primary" busy={!!busy} disabled={!reason.trim() || !pattern.trim()} onClick={add}>{busy ? 'Adding…' : 'Add'}</Button>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
