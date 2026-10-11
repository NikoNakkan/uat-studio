import { Route, Routes, useMatch } from 'react-router';
import { LiveProvider, LiveRail } from './components/Live';
import { RailProvider } from './components/live/RailState';
import { Sidebar } from './components/Sidebar';
import { GuardrailsPage } from './pages/Guardrails';
import { HomePage } from './pages/Home';
import { KnowledgePage } from './pages/Knowledge';
import { RunPage } from './pages/Run';
import { RunsPage } from './pages/Runs';
import { SettingsPage } from './pages/Settings';
import { SetupPage } from './pages/Setup';
import { SwitchesPage } from './pages/Switches';

/** The window: the sidebar, the page, and the live panel beside it. */
export function App() {
  const run = useMatch('/runs/:runId');
  const runId = run?.params.runId ?? '';
  return (
    <RailProvider>
    <LiveProvider channel={runId ? `/api/runs/${runId}/events` : '/api/events/app'}
      refresh={runId ? [['run', runId], ['interactions']] : [['interactions']]} scope={runId ? 'run' : 'app'}>
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow">Skip to content</a>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <main id="main" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 outline-none md:px-8">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/runs" element={<RunsPage />} />
            <Route path="/runs/:runId" element={<RunPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/switches" element={<SwitchesPage />} />
            <Route path="/guardrails" element={<GuardrailsPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
        <LiveRail />
      </div>
    </div>
    </LiveProvider>
    </RailProvider>
  );
}
