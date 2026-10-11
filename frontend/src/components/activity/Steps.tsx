// Tool calls and scripts, folded into one plain line each that opens to the raw input and output.
import type { Event } from '../../api';
import { time } from './Bubbles';
import { describe, parse, pretty, scriptName } from './describe';

export function ToolStep({ call, result }: { call: Event; result?: Event }) {
  const status = !result ? 'running' : result.is_error ? 'error' : 'ok';
  return (
    <details className="group min-w-0 max-w-full text-xs">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded px-1.5 py-0.5 text-muted hover:bg-surface">
        <StepIcon status={status} />
        <span className="min-w-0 flex-1 truncate"><span className="text-ink">{describe(call.tool ?? '', parse(call.input))}</span></span>
        <span className="ml-auto shrink-0 tnum opacity-0 group-hover:opacity-100">{time(call.ts)}</span>
      </summary>
      <div className="mt-1 mb-2 ml-6 grid gap-1 font-mono">
        <div className="text-muted">{call.tool}</div>
        <pre className="max-h-48 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all rounded bg-surface p-2">{pretty(call.input)}</pre>
        {result && <pre className={`max-h-64 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all rounded bg-surface p-2 ${result.is_error ? 'text-bad' : 'text-muted'}`}>
          {result.text}{result.images ? `\n[${result.images} image]` : ''}</pre>}
      </div>
    </details>
  );
}

export function ScriptStep({ start, lines, end }: { start: Event; lines: string[]; end?: Event }) {
  const status = !end ? 'running' : end.code === 0 ? 'ok' : 'error';
  return (
    <details className="group min-w-0 max-w-full text-xs">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded px-1.5 py-0.5 text-muted hover:bg-surface">
        <StepIcon status={status} />
        <span className="min-w-0 flex-1 truncate"><span className="text-ink">Ran {scriptName(start.script)}</span>{end ? ` · exit ${end.code}` : ' · running'}
          {lastLine(lines, end) && <span> · {lastLine(lines, end)}</span>}</span>
        <span className="ml-auto shrink-0 tnum opacity-0 group-hover:opacity-100">{time(start.ts)}</span>
      </summary>
      <pre className="mt-1 mb-2 max-h-64 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all rounded bg-surface p-2 font-mono text-muted">
        $ {start.script}{'\n'}{lines.join('\n') || end?.text || ''}
      </pre>
    </details>
  );
}

function lastLine(lines: string[], end?: Event) {
  const all = lines.length ? lines : (end?.text ?? '').split('\n');
  const l = [...all].reverse().find(x => x.trim());
  return l && l.length > 42 ? l.slice(0, 42) + '…' : l;
}

function StepIcon({ status }: { status: 'running' | 'ok' | 'error' }) {
  if (status === 'running') return <span aria-label="running" className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-warn" />;
  return <span aria-label={status} className={`w-3 shrink-0 text-center ${status === 'ok' ? 'text-good' : 'text-bad'}`}>{status === 'ok' ? '✓' : '✗'}</span>;
}
