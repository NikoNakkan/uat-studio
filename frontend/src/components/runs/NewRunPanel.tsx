import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { useAction } from '../../lib/useAction';
import { Button, Card, Field, Notice, QueryGate, inputCls } from '../../ui';
import { ExcelPicker, useLatestExcel } from '../ExcelPicker';

const STRICTNESS = {
  basic: 'Only what makes a test impossible to run',
  standard: 'Also vague words, unclear names, glossary conflicts (default)',
  strict: 'Also exact values everywhere, and confirm every delete, send or pay step',
};

/** Start a run: the Excel (the last one, or a new file) and how many questions the clarifier may ask. */
export function NewRunPanel({ onClose }: { onClose?: () => void }) {
  const examples = useQuery({ queryKey: ['examples'], queryFn: () => api.get<string[]>('/api/kit/examples') });
  const navigate = useNavigate();
  const latest = useLatestExcel();
  const canReuse = !!latest.data?.reusable;
  const [file, setFile] = useState<File | null>(null);
  const [strictness, setStrictness] = useState<keyof typeof STRICTNESS>('standard');
  const { busy, error, setError, run } = useAction();
  const start = () => run('start', async () => {
    if (!file && !canReuse) return;
    const form = new FormData();
    if (file) form.append('file', file); else form.append('reuse', 'latest');
    form.append('strictness', strictness);
    form.append('start', 'true');
    const r = await api.post<{ id: string; started: boolean; message?: string }>('/api/runs', form);
    if (!r.started && r.message) setError(r.message);
    navigate(`/runs/${r.id}`);
  });
  return (
    <Card title="New run" actions={onClose && <Button kind="ghost" disabled={!!busy} onClick={onClose}>Close</Button>}>
      <form className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] md:items-end" onSubmit={e => { e.preventDefault(); start(); }}>
        <ExcelPicker label="Excel of test cases" file={file} onFile={setFile} disabled={!!busy}
          emptyHint="One row per test case, in the agreed template." />
        <Field label="How many questions?" hint={STRICTNESS[strictness]}>
          <select className={inputCls} value={strictness} disabled={!!busy} onChange={e => setStrictness(e.target.value as keyof typeof STRICTNESS)}>
            {Object.keys(STRICTNESS).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Button type="submit" kind="primary" busy={!!busy} disabled={!file && !canReuse}>{busy ? 'Starting…' : 'Start run'}</Button>
      </form>
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <a className="text-link hover:underline" href="/api/kit/template">Download the Excel template</a>
        <QueryGate pending={examples.isPending} error={examples.isError ? examples.error : null} label="Loading examples…">
          {examples.data?.map(x => <a key={x} className="text-link hover:underline" href={`/api/kit/examples/${x}`}>Example: {x}</a>)}
        </QueryGate>
      </div>
    </Card>
  );
}
