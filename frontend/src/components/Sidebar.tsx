import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { useHealth, useInteractions, useSettings } from '../lib/queries';
import { readStored, writeStored } from '../lib/storage';
import { applyTheme, readTheme, THEME_KEY, writeTheme, type Theme } from '../lib/theme';
import { WaitingLink } from './live/WaitingLink';
import { ProjectSwitcher } from './ProjectSwitcher';

// Small line icons (24px grid, drawn with currentColor) so each page is recognisable at a glance.
const ICONS: Record<string, string> = {
  setup: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  runs: 'M8 5v14l11-7z',
  knowledge: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zm0 0v14m6-12v14',
  guard: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zm-3 9 2 2 4-4',
  switches: 'M4 8h10m4 0h2M4 16h2m4 0h10M14 6v4m-4 4v4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  collapse: 'M15 6l-6 6 6 6',
  expand: 'M9 6l6 6-6 6',
};

const NAV_GROUPS: { label?: string; items: { to: string; label: string; icon: string; end?: boolean }[] }[] = [
  { label: 'Testing', items: [
    { to: '/', label: 'Home', icon: 'home', end: true },
    { to: '/runs', label: 'Test runs', icon: 'runs' },
  ] },
  { label: 'This project', items: [
    { to: '/setup', label: 'Set up', icon: 'setup' },
    { to: '/guardrails', label: 'Guardrails', icon: 'guard' },
    { to: '/knowledge', label: 'Knowledge', icon: 'knowledge' },
    { to: '/switches', label: 'Feature switches', icon: 'switches' },
  ] },
  { items: [{ to: '/settings', label: 'Settings', icon: 'settings' }] },
];
const COLLAPSED_KEY = 'uat-nav-collapsed';

function Icon({ name }: { name: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** The app's navigation, the project, the theme and the app's health. On wide screens it folds to icons. */
export function Sidebar() {
  const health = useHealth();
  const settings = useSettings();
  const open = useInteractions();
  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSED_KEY) === '1');
  const toggle = () => { setCollapsed(!collapsed); writeStored(COLLAPSED_KEY, collapsed ? '0' : '1'); };
  const hide = collapsed ? 'md:sr-only' : '';            // labels stay for screen readers and on small screens
  return (
    <aside className={`shrink-0 border-b border-rail-line bg-rail text-rail-ink md:flex md:h-full md:flex-col md:overflow-y-auto md:overflow-x-hidden md:border-b-0 md:border-r ${collapsed ? 'md:w-14' : 'md:w-56'}`}>
      <div className="h-1 bg-accent" aria-hidden />
      <div className={`flex items-center gap-1.5 py-3 pl-4 pr-2 ${collapsed ? 'md:flex-col md:gap-2 md:px-2' : ''}`}>
        <span className="grid h-8 w-8 shrink-0 place-items-center bg-accent text-[13px] font-bold tracking-tight text-accent-ink">EY</span>
        <div className={`min-w-0 ${hide}`}><div className="font-semibold leading-tight">UAT Studio</div>
          <div className="text-xs leading-tight text-rail-muted">Excel in · evidence out</div></div>
        <ThemeButton />
        <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? 'Show the sidebar' : 'Fold the sidebar to icons'}
          title={collapsed ? 'Show the sidebar' : 'Fold the sidebar to icons'}
          className="hidden h-8 w-8 shrink-0 place-items-center rounded-md text-rail-muted hover:bg-rail-hover hover:text-rail-ink md:grid">
          <Icon name={collapsed ? 'expand' : 'collapse'} />
        </button>
      </div>
      <ProjectSwitcher compact={collapsed} />
      <nav className={`flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:gap-3 md:pb-4 ${collapsed ? 'md:items-center' : ''}`} aria-label="Pages">
        {NAV_GROUPS.map((g, gi) => (
          <div key={gi} className={`flex gap-1 md:flex-col ${!g.label ? 'md:mt-auto md:border-t md:border-rail-line md:pt-3' : ''}`}>
            {g.label && <div className={`hidden px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-rail-muted md:block ${collapsed ? 'md:!hidden' : ''}`}>{g.label}</div>}
            {g.items.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end} title={collapsed ? n.label : undefined}
                className={({ isActive }) => `flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? 'bg-accent font-semibold text-accent-ink' : 'text-rail-muted hover:bg-rail-hover hover:text-rail-ink'}`}>
                <Icon name={n.icon} />
                <span className={hide}>{n.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className={`flex flex-wrap gap-x-3 gap-y-1 px-4 pb-3 text-xs md:grid md:gap-2 ${collapsed ? 'md:justify-items-center md:px-2' : ''}`}>
        {health.isError
          ? <Status ok={false} label="Cannot reach the server" hide={hide} />
          : <Status pending={health.isPending} ok={!!health.data?.kit_found} hide={hide}
              label={health.isPending ? 'Checking the kit…' : health.data?.kit_found ? 'Kit found' : 'Kit not found'} />}
        <Status pending={settings.isPending} ok={!!settings.data?.ai_ready} hide={hide}
          label={settings.isPending ? 'Checking the AI…' : settings.isError ? 'AI unknown'
            : settings.data?.provider === 'copilot' ? 'AI: GitHub Copilot' : settings.data?.api_key_set ? 'API key set' : 'No API key'} />
        {!health.isPending && health.data?.running?.length ? <Status ok label={`Running: ${health.data.running[0]}`} hide={hide} /> : null}
        {open.isPending
          ? <Status pending label="Checking for questions…" hide={hide} />
          : open.data?.length ? <WaitingLink open={open.data} compact={collapsed} /> : null}
      </div>
    </aside>
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
      aria-label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
      className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md text-rail-ink hover:bg-rail-hover md:ml-auto">
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        {dark
          ? <path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4l1.4-1.4m10-10 1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
          : <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />}
      </svg>
    </button>
  );
}

function Status({ ok, label, pending = false, hide = '' }: { ok?: boolean; label: string; pending?: boolean; hide?: string }) {
  const dot = pending ? 'animate-pulse bg-muted' : ok ? 'bg-good' : 'bg-bad';
  return <span className="flex items-center gap-2" role="status" title={label}><span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} /><span className={hide}>{label}</span></span>;
}
