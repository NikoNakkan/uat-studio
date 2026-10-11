// The data the app shares between pages, each defined once: one query key, one type, one refresh rate.
import { useQuery } from '@tanstack/react-query';
import { api, type EnvInfo, type Health, type Interaction, type Projects, type RunDetail, type RunSummary, type SetupCheck, type Settings } from '../api';

/** tests/login.ts still holds this sentence until the login agent (or a person) has written it. */
const LOGIN_TEMPLATE = 'write login() for your app';

export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health'), refetchInterval: 5000 });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') });
export const useSetupCheck = () => useQuery({ queryKey: ['setup'], queryFn: () => api.get<SetupCheck>('/api/setup') });
export const useEnv = () => useQuery({ queryKey: ['env'], queryFn: () => api.get<EnvInfo>('/api/env') });
export const useInteractions = () =>
  useQuery({ queryKey: ['interactions'], queryFn: () => api.get<Interaction[]>('/api/interactions'), refetchInterval: 3000 });
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => api.get<Projects>('/api/projects'), refetchInterval: 10_000 });
export const useRuns = () => useQuery({ queryKey: ['runs'], queryFn: () => api.get<RunSummary[]>('/api/runs'), refetchInterval: 4000 });
export const useRun = (runId: string) =>
  useQuery({ queryKey: ['run', runId], queryFn: () => api.get<RunDetail>(`/api/runs/${runId}`), refetchInterval: 5000 });

/** A text file of the current project's kit (test code, login.ts); nothing is fetched until a path is given. */
export const useKitText = (path: string | null, refetchInterval?: number) => useQuery({
  queryKey: ['kittext', path],
  queryFn: () => api.get<{ text: string }>(`/api/kit/text?path=${encodeURIComponent(path ?? '')}`),
  enabled: !!path, refetchInterval,
});

/** Whether tests/login.ts has been written for this app: pending while unknown. */
export function useLoginWritten() {
  const q = useKitText('tests/login.ts', 5000);
  return { pending: q.isPending, written: !!q.data && !q.data.text.includes(LOGIN_TEMPLATE) };
}
