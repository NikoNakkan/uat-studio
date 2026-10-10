import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, Card, Empty, Pill, Pre, Table, Tabs, errorText, inputCls } from '../ui';

export function KnowledgePage() {
  const [tab, setTab] = useState('glossary');
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
  const q = useQuery({ queryKey: ['glossary'], queryFn: () => api.get<{ text: string }>('/api/kit/glossary') });
  const [text, setText] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  return (
    <Card title="GLOSSARY.md" actions={<Button kind="primary" disabled={text === null} onClick={async () => {
      try { await api.put('/api/kit/glossary', { text }); setMsg('Saved.'); setText(null); q.refetch(); } catch (e) { setMsg(errorText(e)); }
    }}>Save</Button>}>
      <p className="mb-2 text-sm text-muted">The app's own words, one meaning each. The clarifier adds terms as the author explains them.</p>
      <textarea aria-label="Glossary" className={`${inputCls} font-mono`} rows={20} value={text ?? q.data?.text ?? ''} onChange={e => setText(e.target.value)} />
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </Card>
  );
}

function AppMap() {
  const q = useQuery({ queryKey: ['appmap'], queryFn: () => api.get<{ text: string; data: any }>('/api/kit/app-map') });
  const pages = q.data?.data?.pages ?? {};
  if (!Object.keys(pages).length) return <Empty>No app map yet. Playwright's planner writes it during the planner check.</Empty>;
  return (
    <div className="grid gap-4">
      {Object.entries(pages).map(([key, p]: any) => (
        <Card key={key} title={`${key} · ${p.address ?? ''}`}>
          {p.reached_by && <p className="mb-2 text-sm text-muted">Reached by: {p.reached_by}</p>}
          <Table head={['Role', 'Name', 'Example text', 'Test ID']} rows={(p.elements ?? []).map((e: any) => [e.role, e.name || '—', e.example_text ?? '', e.test_id ?? ''])} />
        </Card>
      ))}
    </div>
  );
}

function Config() {
  const list = useQuery({ queryKey: ['config'], queryFn: () => api.get<{ name: string }[]>('/api/kit/config') });
  const [name, setName] = useState('guardrails.yaml');
  const file = useQuery({ queryKey: ['config', name], queryFn: () => api.get<{ text: string }>(`/api/kit/config/${name}`) });
  const [text, setText] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const qc = useQueryClient();
  useEffect(() => { setText(null); setMsg(''); }, [name]);
  return (
    <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <Card title="Files"><ul className="grid gap-1 text-sm">{(list.data ?? []).map(f => (
        <li key={f.name}><button className={`font-mono ${f.name === name ? 'font-semibold text-ink' : 'text-accent hover:underline'}`} onClick={() => setName(f.name)}>{f.name}</button></li>
      ))}</ul><p className="mt-3 text-xs text-muted">Feature switches are changed on their own page.</p></Card>
      <Card title={`config/${name}`} actions={<Button kind="primary" disabled={text === null} onClick={async () => {
        try { await api.put(`/api/kit/config/${name}`, { text }); setMsg('Saved. Run the kit self-tests on the Settings page after changing rules.'); setText(null); qc.invalidateQueries({ queryKey: ['config', name] }); }
        catch (e) { setMsg(errorText(e)); }
      }}>Save</Button>}>
        <textarea aria-label={name} className={`${inputCls} font-mono text-xs`} rows={28} value={text ?? file.data?.text ?? ''} onChange={e => setText(e.target.value)} />
        {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      </Card>
    </div>
  );
}

function TestFiles() {
  const list = useQuery({ queryKey: ['tests'], queryFn: () => api.get<{ path: string; removed: boolean; generated: boolean }[]>('/api/kit/tests') });
  const [open, setOpen] = useState<string | null>(null);
  const file = useQuery({ queryKey: ['kittext', open], queryFn: () => api.get<{ text: string }>(`/api/kit/text?path=${encodeURIComponent(open!)}`), enabled: !!open });
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      <Card title="tests/"><ul className="grid gap-1 font-mono text-xs">{(list.data ?? []).map(t => (
        <li key={t.path} className="flex items-center gap-2"><button className="text-left text-accent hover:underline" onClick={() => setOpen(t.path)}>{t.path}</button>
          {t.removed && <Pill value="-" label="removed" />}</li>))}</ul></Card>
      <Card title={open ?? 'Code'}>{open ? <Pre className="max-h-[70vh] overflow-y-auto">{file.data?.text ?? 'Loading…'}</Pre> : <Empty>Pick a file.</Empty>}</Card>
    </div>
  );
}

function Agents() {
  const q = useQuery({ queryKey: ['agents'], queryFn: () => api.get<any[]>('/api/kit/agents') });
  return <div className="grid gap-3">{(q.data ?? []).map(a => (
    <details key={a.name} className="rounded-lg border border-line bg-surface p-3">
      <summary className="cursor-pointer"><b>{a.name}</b> <span className="text-sm text-muted">{a.description}</span></summary>
      <p className="mt-2 font-mono text-xs text-muted">Tools: {(a.tools ?? []).join(', ')}</p>
      <Pre className="mt-2">{a.body}</Pre>
    </details>
  ))}</div>;
}

function Skills() {
  const q = useQuery({ queryKey: ['skills'], queryFn: () => api.get<any[]>('/api/kit/skills') });
  return <div className="grid gap-3">{(q.data ?? []).map(s => (
    <details key={s.name} className="rounded-lg border border-line bg-surface p-3">
      <summary className="cursor-pointer"><b>{s.name}</b> <Pill value={s.on ? 'on' : 'off'} /> <span className="text-sm text-muted">{s.description}</span></summary>
      <p className="mt-2 font-mono text-xs text-muted">{s.files.join(' · ')}</p>
      <Pre className="mt-2">{s.text}</Pre>
    </details>
  ))}</div>;
}
