import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Button, errorText } from '../ui';

export type LatestExcel = { source: string; excel: string; cases: number; reusable: boolean; accounts: string[] };

/** The Excel Studio already has: the newest run's, or the one given to login setup. */
export function useLatestExcel() {
  return useQuery({ queryKey: ['excel-latest'], queryFn: () => api.get<LatestExcel>('/api/excel/latest') });
}

/**
 * Which Excel of test cases is used: the one Studio already has, unless the person picks another file. Shared by
 * the login step and the new-run step, so both show the same file the same way (never a bare "No file chosen").
 */
export function ExcelPicker({ label, file, onFile, disabled, emptyHint }: {
  label: string; file: File | null; onFile: (f: File | null) => void; disabled?: boolean; emptyHint: string;
}) {
  const latest = useLatestExcel();
  const picker = useRef<HTMLInputElement>(null);
  const known = latest.data?.source ? latest.data : null;
  return (
    <div className="grid gap-1.5">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-2/40 px-3 py-2">
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded bg-good/15 text-xs font-semibold text-good">XLS</span>
        <div className="min-w-0 flex-1 text-sm">
          {file ? <>
            <div className="truncate font-medium">{file.name}</div>
            <div className="text-xs text-muted">Chosen now{known ? ` instead of ${known.excel}` : ''}.</div>
          </> : latest.isPending ? <div className="text-muted">Finding the Excel in use…</div>
            : latest.isError ? <div className="text-bad">Could not tell which Excel is in use ({errorText(latest.error)}).</div>
            : known ? <>
              <div className="truncate font-medium">{known.excel}</div>
              <div className="text-xs text-muted">{known.cases} cases · from {known.source}
                {known.accounts.length ? ` · accounts: ${known.accounts.join(', ')}` : ''}</div>
            </> : <>
              <div className="font-medium">No Excel yet</div>
              <div className="text-xs text-muted">{emptyHint}</div>
            </>}
        </div>
        <input ref={picker} type="file" accept=".xlsx" className="sr-only" tabIndex={-1} aria-hidden
          onChange={e => onFile(e.target.files?.[0] ?? null)} />
        <Button disabled={disabled} onClick={() => picker.current?.click()}>{file || known ? 'Use a different Excel…' : 'Choose Excel…'}</Button>
        {file && <Button kind="ghost" disabled={disabled} onClick={() => { onFile(null); if (picker.current) picker.current.value = ''; }}>Undo</Button>}
      </div>
    </div>
  );
}
