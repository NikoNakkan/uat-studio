import { NavLink, Route, Routes } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, type Interaction } from './api';
import { RunsPage } from './pages/Runs';
import { RunPage } from './pages/Run';
import { SetupPage } from './pages/Setup';
import { SwitchesPage } from './pages/Switches';
import { KnowledgePage } from './pages/Knowledge';
import { SettingsPage } from './pages/Settings';

const NAV = [
  { to: '/', label: 'Runs', end: true },
  { to: '/setup', label: 'Setup' },
  { to: '/switches', label: 'Feature switches' },
  { to: '/knowledge', label: 'Knowledge' },
  { to: '/settings', label: 'Settings' },
];

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<any>('/api/health'), refetchInterval: 5000 });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<any>('/api/settings') });
  const open = useQuery({ queryKey: ['interactions'], queryFn: () => api.get<Interaction[]>('/api/interactions'), refetchInterval: 3000 });
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="border-b border-line bg-surface md:w-56 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-ink font-mono text-xs font-semibold">UAT</span>
          <div><div className="font-semibold leading-tight">UAT Studio</div>
            <div className="text-xs text-muted leading-tight">Excel in · evidence out</div></div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-accent-soft font-medium text-ink' : 'text-muted hover:text-ink hover:bg-surface-2'}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden gap-2 px-4 pb-4 text-xs md:grid">
          <Status ok={!!health.data?.kit_found} label={health.data?.kit_found ? 'Kit found' : 'Kit not found'} />
          <Status ok={!!settings.data?.api_key_set} label={settings.data?.api_key_set ? 'API key set' : 'No API key'} />
          {health.data?.running?.length ? <Status ok label={`Running: ${health.data.running[0]}`} /> : null}
          {open.data?.length ? <span className="rounded bg-warn/15 px-2 py-1 font-medium text-warn">{open.data.length} waiting for you</span> : null}
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 md:px-8">
        <Routes>
          <Route path="/" element={<RunsPage />} />
          <Route path="/runs/:runId" element={<RunPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/switches" element={<SwitchesPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${ok ? 'bg-good' : 'bg-bad'}`} />{label}</span>;
}
