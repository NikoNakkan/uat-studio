import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useMatch } from 'react-router';
import { useHealth, useInteractions, useSettings } from './lib/queries';
import { applyTheme, readTheme, THEME_KEY, writeTheme, type Theme } from './lib/theme';

import { LiveProvider, LiveRail } from './components/Live';
import { ProjectSwitcher } from './components/ProjectSwitcher';
import { RunsPage } from './pages/Runs';
import { RunPage } from './pages/Run';
import { SetupPage } from './pages/Setup';
import { SwitchesPage } from './pages/Switches';
import { KnowledgePage } from './pages/Knowledge';
import { SettingsPage } from './pages/Settings';

// Small line icons (24px grid, drawn with currentColor) so each page is recognisable at a glance.
const ICONS: Record<string, string> = {
  setup: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  runs: 'M8 5v14l11-7z',
  knowledge: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zm0 0v14m6-12v14',
  switches: 'M4 8h10m4 0h2M4 16h2m4 0h10M14 6v4m-4 4v4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
};

const NAV_GROUPS: { label?: string; items: { to: string; label: string; icon: string; end?: boolean }[] }[] = [
  { label: 'Testing', items: [
    { to: '/setup', label: 'Set up', icon: 'setup' },
    { to: '/', label: 'Test runs', icon: 'runs', end: true },
  ] },
  { label: 'This project', items: [
    { to: '/knowledge', label: 'Knowledge', icon: 'knowledge' },
    { to: '/switches', label: 'Feature switches', icon: 'switches' },
  ] },
  { items: [{ to: '/settings', label: 'Settings', icon: 'settings' }] },
];

function NavIcon({ name }: { name: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function App() {
  const health = useHealth();
  const settings = useSettings();
  const open = useInteractions();
  const run = useMatch('/runs/:runId');
  const runId = run?.params.runId ?? '';
  return (
    <LiveProvider channel={runId ? `/api/runs/${runId}/events` : '/api/events/app'}
      refresh={runId ? [['run', runId], ['interactions']] : [['interactions']]} scope={runId ? 'run' : 'app'}>
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow">Skip to content</a>
      <aside className="shrink-0 border-b border-rail-line bg-rail text-rail-ink md:h-full md:w-56 md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="h-1 bg-accent" aria-hidden />
        <div className="flex items-center gap-2.5 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center bg-accent text-[13px] font-bold tracking-tight text-accent-ink">EY</span>
          <div><div className="font-semibold leading-tight">UAT Studio</div>
            <div className="text-xs leading-tight text-rail-muted">Excel in · evidence out</div></div>
        </div>
        <ProjectSwitcher />
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:gap-3 md:pb-4" aria-label="Pages">
          {NAV_GROUPS.map((g, gi) => (
            <div key={gi} className={`flex gap-1 md:flex-col ${!g.label ? 'md:mt-auto md:border-t md:border-rail-line md:pt-3' : ''}`}>
              {g.label && <div className="hidden px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-rail-muted md:block">{g.label}</div>}
              {g.items.map(n => (
                <NavLink key={n.to} to={n.to} end={n.end}
                  className={({ isActive }) => `flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? 'bg-accent font-semibold text-accent-ink' : 'text-rail-muted hover:bg-rail-hover hover:text-rail-ink'}`}>
                  <NavIcon name={n.icon} />
                  {n.label}
                </NavLink>
              ))}
            </div>
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
                  className="rounded bg-accent px-2 py-1 font-semibold text-accent-ink hover:brightness-95">{open.data.length} waiting for you →</Link>
              : null}
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-end border-b border-line bg-surface px-4 py-1.5 md:px-8">
          <ThemeButton />
        </div>
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
    </div>
    </LiveProvider>
  );
}

function ThemeButton() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      const next = readTheme();
      setTheme(next);
      applyTheme(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const dark = theme === 'dark';
  const choose = () => {
    const next: Theme = dark ? 'light' : 'dark';
    setTheme(next);
    writeTheme(next);
  };
  return (
    <button type="button" onClick={choose} aria-pressed={dark}
      title={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-sm font-medium text-ink hover:bg-surface-2">
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        {dark
          ? <path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4l1.4-1.4m10-10 1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
          : <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />}
      </svg>
      {dark ? 'Light theme' : 'Dark theme'}
    </button>
  );
}

function Status({ ok, label, pending = false }: { ok?: boolean; label: string; pending?: boolean }) {
  const dot = pending ? 'animate-pulse bg-muted' : ok ? 'bg-good' : 'bg-bad';
  return <span className="flex items-center gap-2" role="status"><span className={`h-2 w-2 rounded-full ${dot}`} />{label}</span>;
}
