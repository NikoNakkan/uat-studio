import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { AppMapView, type MapPage } from '../components/AppMapView';
import { TextFileEditor } from '../components/TextFileEditor';
import { Card, Empty, Loading, Notice, Pill, Pre, QueryGate, Table, Tabs, errorText, useTitle } from '../ui';

type AgentInfo = { name: string; description: string; tools: string[]; body: string };
type SkillInfo = { name: string; description: string; on: boolean; files: string[]; text: string };

const TAB_LABEL: Record<string, string> = {
  glossary: 'Glossary', appmap: 'App map', config: 'Rules', tests: 'Test files', agents: 'Agents', skills: 'Skills',
};

export function KnowledgePage() {
  const [tab, setTab] = useState('glossary');
  useTitle(`Knowledge · ${TAB_LABEL[tab] ?? 'Knowledge'}`);
  return (
    <div className="mx-auto grid max-w-7xl gap-4">
      <div>
        <h1 className="text-xl font-semibold">Knowledge</h1>
        <p className="text-sm text-muted">What the flow knows about your app, the rules it follows, and the agents and skills that do the work.</p>
      </div>
      <Tabs current={tab} onChange={setTab} tabs={[{ id: 'glossary', label: 'Glossary' }, { id: 'appmap', label: 'App map' },
        { id: 'config', label: 'Rules (config)' }, { id: 'tests', label: 'Test files' }, { id: 'agents', label: 'Agents' }, { id: 'skills', label: 'Skills' }]} />
      {tab === 'glossary' && <Glossary />}
      {tab === 'appmap' && <AppMap />}
      {tab === 'config' && <Config />}
      {tab === 'tests' && <TestFiles />}
      {tab === 'agents' && <Agents />}
      {tab === 'skills' && <Skills />}
    </div>
  );
}

function Glossary() {
  return <TextFileEditor url="/api/kit/glossary" title="GLOSSARY.md"
    intro="The app's own words, one meaning each. The clarifier adds terms as the author explains them." />;
}

function AppMap() {
  const q = useQuery({ queryKey: ['appmap'], queryFn: () => api.get<{ text: string; data: { pages?: Record<string, MapPage> } | null }>('/api/kit/app-map') });
  const [view, setView] = useState<'map' | 'tables'>('map');
  if (q.isPending) return <Loading label="Loading the app map…" />;
  if (q.isError) return <Notice>{errorText(q.error)}</Notice>;
  const pages = q.data?.data?.pages ?? {};
  if (!Object.keys(pages).length) return <Empty>No app map yet. Playwright's planner writes it during the planner check.</Empty>;
  return (
    <div className="grid gap-4">
      <div className="flex gap-1 text-sm" role="tablist" aria-label="App map view">
        {(['map', 'tables'] as const).map(v => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`rounded-md px-3 py-1 ${view === v ? 'bg-accent text-accent-ink' : 'border border-line bg-surface text-muted hover:text-ink'}`}>
            {v === 'map' ? 'Map' : 'Tables'}</button>
        ))}
      </div>
      {view === 'map' ? <AppMapView pages={pages} /> : Object.entries(pages).map(([key, p]) => (
        <Card key={key} title={`${key} · ${p.address ?? ''}`}>
          {p.reached_by && <p className="mb-2 text-sm text-muted">Reached by: {p.reached_by}</p>}
          <Table head={['Role', 'Name', 'Example text', 'Test ID']} rows={(p.elements ?? []).map(e => [e.role, e.name || '—', e.example_text ?? '', e.test_id ?? ''])} />
        </Card>
      ))}
    </div>
  );
}

function Config() {
  const list = useQuery({ queryKey: ['config'], queryFn: () => api.get<{ name: string }[]>('/api/kit/config') });
  const [name, setName] = useState('guardrails.yaml');
  return (
    <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <Card title="Files">
        <QueryGate pending={list.isPending} error={list.isError ? list.error : null} label="Loading rule files…">
          <ul className="grid gap-1 text-sm">{(list.data ?? []).map(f => (
            <li key={f.name}><button className={`font-mono ${f.name === name ? 'font-semibold text-ink' : 'text-link hover:underline'}`} onClick={() => setName(f.name)}>{f.name}</button></li>
          ))}</ul>
        </QueryGate>
        <p className="mt-3 text-xs text-muted">Feature switches are changed on their own page.</p>
      </Card>
      <TextFileEditor key={name} url={`/api/kit/config/${name}`} title={`config/${name}`} rows={28} small
        savedNote="Saved. Run the kit self-tests on the Settings page after changing rules." />
    </div>
  );
}

function TestFiles() {
  const list = useQuery({ queryKey: ['tests'], queryFn: () => api.get<{ path: string; removed: boolean; generated: boolean }[]>('/api/kit/tests') });
  const [open, setOpen] = useState<string | null>(null);
  const file = useQuery({ queryKey: ['kittext', open], queryFn: () => api.get<{ text: string }>(`/api/kit/text?path=${encodeURIComponent(open!)}`), enabled: !!open });
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      <Card title="tests/">
        <QueryGate pending={list.isPending} error={list.isError ? list.error : null} label="Loading test files…">
          {list.data?.length ? <ul className="grid gap-1 font-mono text-xs">{list.data.map(t => (
            <li key={t.path} className="flex items-center gap-2">
              <button className={`text-left hover:underline ${open === t.path ? 'font-semibold text-ink' : 'text-link'}`} aria-current={open === t.path ? 'true' : undefined} onClick={() => setOpen(t.path)}>{t.path}</button>
              {t.removed && <Pill value="-" label="removed" />}
            </li>))}</ul> : <Empty>No test files.</Empty>}
        </QueryGate>
      </Card>
      <Card title={open ?? 'Code'}>
        {!open ? <Empty>Pick a file.</Empty>
          : <QueryGate pending={file.isPending} error={file.isError ? file.error : null} label="Loading file…">
              <Pre className="max-h-[70vh] overflow-y-auto">{file.data?.text}</Pre>
            </QueryGate>}
      </Card>
    </div>
  );
}

function Agents() {
  const q = useQuery({ queryKey: ['agents'], queryFn: () => api.get<AgentInfo[]>('/api/kit/agents') });
  if (q.isPending) return <Loading label="Loading agents…" />;
  if (q.isError) return <Notice>{errorText(q.error)}</Notice>;
  if (!q.data.length) return <Empty>No agents found.</Empty>;
  return <div className="grid gap-3">{q.data.map(a => (
    <details key={a.name} className="rounded-lg border border-line bg-surface p-3">
      <summary className="cursor-pointer"><b>{a.name}</b> <span className="text-sm text-muted">{a.description}</span></summary>
      <p className="mt-2 font-mono text-xs text-muted">Tools: {(a.tools ?? []).join(', ')}</p>
      <Pre className="mt-2">{a.body}</Pre>
    </details>
  ))}</div>;
}

function Skills() {
  const q = useQuery({ queryKey: ['skills'], queryFn: () => api.get<SkillInfo[]>('/api/kit/skills') });
  if (q.isPending) return <Loading label="Loading skills…" />;
  if (q.isError) return <Notice>{errorText(q.error)}</Notice>;
  if (!q.data.length) return <Empty>No skills found.</Empty>;
  return <div className="grid gap-3">{q.data.map(s => (
    <details key={s.name} className="rounded-lg border border-line bg-surface p-3">
      <summary className="cursor-pointer"><b>{s.name}</b> <Pill value={s.on ? 'on' : 'off'} /> <span className="text-sm text-muted">{s.description}</span></summary>
      <p className="mt-2 font-mono text-xs text-muted">{s.files.join(' · ')}</p>
      <Pre className="mt-2">{s.text}</Pre>
    </details>
  ))}</div>;
}
