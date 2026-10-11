import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Settings } from '../api';
import { useAction } from '../lib/useAction';
import { Button, Card, MsgNotice, QueryGate, fail, ok, type Msg } from '../ui';
import { ApiKeyBox } from './ApiKey';
import { CopilotToken } from './CopilotToken';

type Quota = { used: number | null; allowed: number | null; unlimited: boolean; resets: string | null };
type CopilotStatus = { signed_in: boolean; login: string | null; via: string | null; quota: Record<string, Quota>; error?: string };

const CHOICES = [
  { id: 'anthropic', title: 'Anthropic API key', about: 'Pay per token on your Anthropic account. Every model, exact token costs.' },
  { id: 'copilot', title: 'GitHub Copilot', about: 'Use your Copilot plan, signed in with GitHub. Billed in premium requests.' },
] as const;

/** Who runs the agents: an Anthropic API key, or the person's GitHub Copilot plan. Saved as soon as it is picked. */
export function AiProviderCard({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const { busy, error, run } = useAction();
  const choose = (provider: string) => run('provider', async () => {
    await api.put('/api/settings', { provider });
    await qc.invalidateQueries({ queryKey: ['settings'] });
  });
  return (
    <Card title="Who runs the AI">
      <div role="radiogroup" aria-label="AI provider" className="grid gap-3 sm:grid-cols-2">
        {CHOICES.map(c => {
          const on = settings.provider === c.id;
          return (
            <button key={c.id} type="button" role="radio" aria-checked={on} disabled={!!busy} onClick={() => !on && choose(c.id)}
              className={`rounded-lg border-2 p-3 text-left ${on ? 'border-accent bg-accent/10' : 'border-line hover:border-muted'}`}>
              <div className="flex items-center gap-2 font-semibold">
                <span aria-hidden className={`grid h-4 w-4 place-items-center rounded-full border-2 ${on ? 'border-accent' : 'border-muted'}`}>
                  {on && <span className="h-2 w-2 rounded-full bg-accent" />}</span>
                {c.title}
              </div>
              <p className="mt-1 text-sm text-muted">{c.about}</p>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <div className="mt-4">{settings.provider === 'copilot'
        ? <div className="grid gap-4"><CopilotBox /><CopilotToken settings={settings} /></div>
        : <ApiKeyBox settings={settings} />}</div>
    </Card>
  );
}

function CopilotBox() {
  const q = useQuery({ queryKey: ['copilot'], queryFn: () => api.get<CopilotStatus>('/api/copilot/status'), refetchInterval: 60_000 });
  const [msg, setMsg] = useState<Msg>(null);
  const { busy, run } = useAction();
  const test = () => run('test', async () => {
    setMsg(null);
    try {
      const r = await api.post<{ answer: string; model: string }>('/api/settings/test');
      setMsg(ok(`Copilot answered "${r.answer.trim()}" with ${r.model.replace('copilot:', '')}.`));
    } catch (e) { setMsg(fail(e)); }
  });
  return (
    <QueryGate pending={q.isPending} error={q.isError ? q.error : null} label="Asking GitHub who is signed in…">
      {q.data && (q.data.signed_in ? <SignedIn s={q.data} /> : <SignIn error={q.data.error} />)}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button busy={busy === 'test'} disabled={!!busy || !q.data?.signed_in} onClick={test}>{busy ? 'Testing…' : 'Test Copilot'}</Button>
        <Button kind="ghost" disabled={q.isFetching} onClick={() => q.refetch()}>{q.isFetching ? 'Checking…' : 'Check again'}</Button>
        <MsgNotice msg={msg} className="" />
      </div>
    </QueryGate>
  );
}

function SignedIn({ s }: { s: CopilotStatus }) {
  const premium = s.quota.premium_interactions;
  const chat = s.quota.chat;
  const noPremium = premium && !premium.unlimited && !premium.allowed;
  return (
    <div className="grid gap-2 text-sm">
      <p><span className="mr-2 inline-block h-2 w-2 rounded-full bg-good" aria-hidden />{s.login ? <>Signed in to GitHub as <b>{s.login}</b></> : 'Signed in to GitHub'}
        {s.via === 'gh-cli' ? <span className="text-muted"> (from the GitHub CLI on this computer)</span>
          : s.via ? <span className="text-muted"> (with the GitHub token)</span> : null}</p>
      <div className="flex flex-wrap gap-x-6 gap-y-1 tnum">
        {premium && <span>Premium requests: <b>{premium.unlimited ? 'unlimited' : `${premium.used ?? 0} of ${premium.allowed ?? 0}`}</b> used</span>}
        {chat && <span>Chat requests: <b>{chat.unlimited ? 'unlimited' : `${chat.used ?? 0} of ${chat.allowed ?? 0}`}</b> used</span>}
      </div>
      {noPremium && (
        <p className="rounded-md border border-warn/60 bg-warn/5 p-2">
          This plan has no premium requests, so the agents run on Copilot's included model instead of Claude. With a paid plan
          (for example Copilot Pro) each agent uses its own model below. A plan bought just now can take a few minutes to show.
        </p>
      )}
      <p className="text-xs text-muted">One premium request is one message to an agent; the agent's own tool calls in that conversation do not count again.</p>
    </div>
  );
}

function SignIn({ error }: { error?: string }) {
  return (
    <div className="grid gap-2 text-sm">
      <p><b>Not signed in to GitHub.</b> Save a GitHub token below, or sign in once on this computer with the GitHub CLI, then press Check again:</p>
      <code className="w-fit rounded bg-surface-2 px-2 py-1">gh auth login</code>
      <p className="text-muted">You type your password into GitHub's own page, never into Studio. The account needs a Copilot plan or a company Copilot seat.</p>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
