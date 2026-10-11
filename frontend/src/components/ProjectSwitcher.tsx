import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useAction } from '../lib/useAction';
import { Button, Field, inputCls } from '../ui';

type Project = { id: string; name: string; dir: string; current: boolean; runs: number; running: string[]; created: string };

const BROADCAST = 'uat-project-changed';

/** Every Studio tab follows a switch: the project lives in a cookie all tabs share, so the others reload. */
function announceAndGo(path: string) {
  try { localStorage.setItem(BROADCAST, String(Date.now())); } catch { /* private window: other tabs reload on focus */ }
  window.location.assign(path);
}

/**
 * The project switcher: which app under test this window works on. Each project has its own folder, accounts,
 * login, tests, app map, switches and runs; a run keeps its project even when you switch while it runs.
 */
export function ProjectSwitcher() {
  const q = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ current: string; projects: Project[] }>('/api/projects'), refetchInterval: 10_000 });
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | 'new' | 'rename'>('list');
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [msg, setMsg] = useState('');
  const { busy, error, run } = useAction();
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  const current = q.data?.projects.find(p => p.current);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === BROADCAST) window.location.reload(); };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!box.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('storage', onStorage);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('storage', onStorage); document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, []);

  // The sidebar clips anything wider than itself, so the panel is drawn on <body>, anchored under the button.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(Math.max(r.width - 16, 320), window.innerWidth - 16);
      setPlace({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left + 8, window.innerWidth - width - 8)), width });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open]);

  const act = (what: string, fn: () => Promise<void>) => { setMsg(''); return run(what, fn); };

  return (
    <div ref={box} className="relative px-2 pb-2">
      <button type="button" onClick={() => { setOpen(!open); setMode('list'); setMsg(''); }} aria-expanded={open} aria-haspopup="dialog"
        className="flex w-full items-center gap-2 rounded-md border border-line bg-surface-2/60 px-2.5 py-2 text-left hover:border-accent">
        <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent/15 text-[11px] font-semibold text-accent">
          {(current?.name ?? '?').slice(0, 2).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] uppercase tracking-wide text-muted">Project</span>
          <span className="block truncate text-sm font-semibold">{q.isPending ? 'Loading…' : current?.name ?? 'No project'}</span>
        </span>
        <span aria-hidden className="text-muted">▾</span>
      </button>

      {open && place && createPortal(
        <div ref={panel} role="dialog" aria-label="Projects" style={{ top: place.top, left: place.left, width: place.width }}
          className="fixed z-50 grid max-h-[calc(100vh-6rem)] gap-2 overflow-y-auto rounded-lg border border-line bg-surface p-2 shadow-lg">
          {mode === 'list' && <>
            <ul className="grid max-h-72 gap-0.5 overflow-y-auto">
              {(q.data?.projects ?? []).map(p => (
                <li key={p.id}>
                  <button type="button" disabled={!!busy} onClick={() => p.current ? setOpen(false) : act(`use:${p.id}`, async () => {
                    await api.post(`/api/projects/${p.id}/use`); announceAndGo('/');
                  })} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${p.current ? 'bg-accent-soft font-medium' : 'hover:bg-surface-2'}`}>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.running.length > 0 && <span className="h-2 w-2 animate-pulse rounded-full bg-good" title={`Running: ${p.running.join(', ')}`} />}
                    <span className="text-xs text-muted tnum">{p.runs} run{p.runs === 1 ? '' : 's'}</span>
                    {busy === `use:${p.id}` && <span className="text-xs text-muted">Switching…</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="grid gap-1 border-t border-line pt-2">
              <Button kind="primary" onClick={() => { setMode('new'); setName(''); setStart(''); }}>New project…</Button>
              {current && <div className="flex flex-wrap gap-1">
                <Button kind="ghost" onClick={() => { setMode('rename'); setName(current.name); }}>Rename</Button>
                {current.id !== 'main' && <Button kind="ghost" busy={busy === 'sync'} disabled={!!busy} onClick={() => act('sync', async () => {
                  const r = await api.post<{ updated: string[] }>(`/api/projects/${current.id}/sync`);
                  setMsg(`Kit files updated from the main kit (${r.updated.length} items). Tests, app map, runs and accounts unchanged.`);
                })}>{busy === 'sync' ? 'Updating…' : 'Update kit files'}</Button>}
              </div>}
              {current && <p className="break-all px-1 text-[11px] text-muted" title="This project's folder">{current.dir}</p>}
            </div>
          </>}

          {mode === 'new' && (
            <form className="grid gap-2" onSubmit={e => { e.preventDefault(); act('create', async () => {
              await api.post('/api/projects', { name, start_page: start }); announceAndGo('/setup');
            }); }}>
              <div className="text-sm font-semibold">New project</div>
              <p className="text-xs text-muted">A separate folder with its own accounts, login, tests, app map, switches and runs. The kit's code is copied in from the main kit.</p>
              <Field label="Name"><input className={inputCls} autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Lumen Clinic" /></Field>
              <Field label="Start page" hint="Where the tests start. It also becomes the only site the browser may open; you can add more in Setup.">
                <input className={inputCls} value={start} onChange={e => setStart(e.target.value)} placeholder="https://test.app.example.com" />
              </Field>
              <div className="flex gap-1.5">
                <Button type="submit" kind="primary" busy={busy === 'create'} disabled={!name.trim() || !start.trim() || !!busy}>{busy === 'create' ? 'Creating…' : 'Create and set up'}</Button>
                <Button disabled={!!busy} onClick={() => setMode('list')}>Back</Button>
              </div>
            </form>
          )}

          {mode === 'rename' && current && (
            <form className="grid gap-2" onSubmit={e => { e.preventDefault(); act('rename', async () => {
              await api.put(`/api/projects/${current.id}`, { name }); await q.refetch(); setMode('list');
            }); }}>
              <Field label="Project name"><input className={inputCls} autoFocus value={name} onChange={e => setName(e.target.value)} /></Field>
              <div className="flex gap-1.5">
                <Button type="submit" kind="primary" busy={busy === 'rename'} disabled={!name.trim() || !!busy}>{busy === 'rename' ? 'Saving…' : 'Save'}</Button>
                <Button disabled={!!busy} onClick={() => setMode('list')}>Back</Button>
              </div>
            </form>
          )}
          {(error || msg) && <p role="status" className={`px-1 text-xs ${error ? 'text-bad' : 'text-muted'}`}>{error || msg}</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}
