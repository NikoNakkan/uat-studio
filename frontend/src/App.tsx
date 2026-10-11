import { Link, NavLink, Route, Routes, useMatch } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, type Interaction } from './api';
import { LiveProvider, LiveRail } from './components/Live';
import { RunsPage } from './pages/Runs';
import { RunPage } from './pages/Run';
import { SetupPage } from './pages/Setup';
import { SwitchesPage } from './pages/Switches';
import { KnowledgePage } from './pages/Knowledge';
import { SettingsPage } from './pages/Settings';

const NAV = [
  { to: '/setup', label: '1  Set up' },
  { to: '/', label: '2  Test runs', end: true },
  { to: '/switches', label: 'Feature switches' },
  { to: '/knowledge', label: 'Knowledge' },
  { to: '/settings', label: 'Settings' },
];

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<any>('/api/health'), refetchInterval: 5000 });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<any>('/api/settings') });
  const open = useQuery({ queryKey: ['interactions'], queryFn: () => api.get<Interaction[]>('/api/interactions'), refetchInterval: 3000 });
  const run = useMatch('/runs/:runId');
  const runId = run?.params.runId ?? '';
  return (
    <LiveProvider channel={runId ? `/api/runs/${runId}/events` : '/api/events/app'}
      refresh={runId ? [['run', runId], ['interactions']] : [['interactions']]} scope={runId ? 'run' : 'app'}>
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow">Skip to content</a>
      <aside className="shrink-0 border-b border-line bg-surface md:h-full md:w-56 md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-ink font-mono text-xs font-semibold">UAT</span>
          <div><div className="font-semibold leading-tight">UAT Studio</div>
            <div className="text-xs text-muted leading-tight">Excel in · evidence out</div></div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4" aria-label="Pages">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? 'bg-accent-soft font-medium text-ink' : 'text-muted hover:text-ink hover:bg-surface-2'}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 pb-3 text-xs md:grid md:gap-2 md:pb-4">
          {health.isError
            ? <Status ok={false} label="Cannot reach the server" />
            : <Status pending={health.isPending} ok={!!health.data?.kit_found} label={health.isPending ? 'Checking the kit…' : health.data?.kit_found ? 'Kit found' : 'Kit not found'} />}
          <Status pending={settings.isPending} ok={!!settings.data?.api_key_set} label={settings.isPending ? 'Checking the API key…' : settings.isError ? 'API key unknown' : settings.data?.api_key_set ? 'API key set' : 'No API key'} />
          {!health.isPending && health.data?.running?.length ? <Status ok label={`Running: ${health.data.running[0]}`} /> : null}
          {open.isPending
            ? <Status pending label="Checking for questions…" />
            : open.data?.length
              ? <Link to={open.data[0].channel === 'app' ? '/setup' : `/runs/${open.data[0].channel}`}
                  className="rounded bg-warn/15 px-2 py-1 font-medium text-warn hover:bg-warn/25">{open.data.length} waiting for you →</Link>
              : null}
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <main id="main" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 outline-none md:px-8">
          <Routes>
            <Route path="/" element={<RunsPage />} />
            <Route path="/runs/:runId" element={<RunPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/switches" element={<SwitchesPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
        <LiveRail />
      </div>
    </div>
    </LiveProvider>
  );
}

function Status({ ok, label, pending = false }: { ok?: boolean; label: string; pending?: boolean }) {
  const dot = pending ? 'animate-pulse bg-muted' : ok ? 'bg-good' : 'bg-bad';
  return <span className="flex items-center gap-2" role="status"><span className={`h-2 w-2 rounded-full ${dot}`} />{label}</span>;
}
