import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type SetupCheck } from '../../api';
import { useAction } from '../../lib/useAction';
import { Button, Loading, Notice, Pill, Pre, QueryGate, Table } from '../../ui';

/** The fix a requirement row offers, as the id the server accepts (POST /api/setup/fix). */
function fixFor(fix: string): string | null {
  if (fix.includes('init-agents')) return 'init-agents';
  if (fix.includes('playwright install')) return 'playwright-chromium';
  if (fix.includes('npm install')) return 'npm-install';
  if (fix.includes('pip install')) return 'pip-install';
  return null;
}

const ORDER = ['npm-install', 'playwright-chromium', 'pip-install', 'init-agents'];   // what the later fixes need first

/** What this machine needs (Node.js, Playwright, Python, the kit) and, after a yes, the fix for what is missing. */
export function Machine({ check }: { check: { data?: SetupCheck; isPending: boolean; isFetching: boolean; isError: boolean; error: unknown } }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<{ id: string; text: string }[] | null>(null);
  const [output, setOutput] = useState('');
  const { busy, error, run } = useAction();
  // Every fix the missing rows offer, once each, in the order they depend on each other.
  const all = ORDER.flatMap(id => {
    const row = (check.data?.rows ?? []).find(r => r.status !== 'OK' && fixFor(r.fix) === id);
    return row ? [{ id, text: row.fix }] : [];
  });
  const fix = (list: { id: string; text: string }[]) => {
    setConfirm(null);
    run(list.map(c => c.text).join(' · '), async () => {
      const outputs: string[] = [];
      for (const c of list) {
        const r = await api.post<{ output?: string }>('/api/setup/fix', { id: c.id });
        outputs.push(`$ ${c.text}\n${r?.output ?? ''}`);
        setOutput(outputs.join('\n\n'));
      }
      qc.invalidateQueries({ queryKey: ['setup'] });
    });
  };
  return (
    <div className="grid gap-3">
      <QueryGate pending={check.isPending} error={check.isError ? check.error : null} label="Checking this machine…">
        <Table head={['', 'Requirement', 'Fix']} rows={(check.data?.rows ?? []).map(row => {
          const id = fixFor(row.fix);
          return [<Pill value={row.status} />, row.item, id
            ? <Button disabled={!!busy} onClick={() => setConfirm([{ id, text: row.fix }])}>Fix: {row.fix}</Button>
            : <span className="text-sm text-muted">{row.fix}</span>];
        })} />
      </QueryGate>
      {confirm && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warn/60 p-3 text-sm">
          <span>This installs software on this machine: {confirm.map(c => <code key={c.id} className="mr-1 font-mono">{c.text}</code>)}. Run {confirm.length > 1 ? 'them' : 'it'} now?</span>
          <Button kind="primary" onClick={() => fix(confirm)}>Yes, run it</Button>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
        </div>
      )}
      {busy && <Loading label={`Running ${busy}…`} />}
      {output && <Pre className="max-h-64 overflow-y-auto">{output}</Pre>}
      {error && <Notice>{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        {all.length > 1 && !confirm && <Button kind="primary" disabled={!!busy} onClick={() => setConfirm(all)}>Fix everything ({all.length})</Button>}
        <Button busy={check.isFetching} onClick={() => qc.invalidateQueries({ queryKey: ['setup'] })}>{check.isFetching ? 'Checking…' : 'Check again'}</Button>
      </div>
    </div>
  );
}
