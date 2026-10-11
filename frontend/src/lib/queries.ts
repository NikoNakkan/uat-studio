// The data the app shares between pages, each defined once: one query key, one type, one refresh rate.
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, type EnvInfo, type Health, type Interaction, type Projects, type RunCost, type RunDetail, type RunSummary, type SetupCheck, type Settings } from '../api';

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
/** A run's cost breakdown, fetched only once someone opens it. */
export const useRunCost = (runId: string, enabled: boolean) =>
  useQuery({ queryKey: ['runcost', runId], queryFn: () => api.get<RunCost>(`/api/runs/${runId}/cost`), enabled, refetchInterval: 10_000 });

/** A text file of the current project's kit (test code, login.ts); nothing is fetched until a path is given. */
export const useKitText = (path: string | null, refetchInterval?: number) => useQuery({
  queryKey: ['kittext', path],
  queryFn: () => api.get<{ text: string }>(`/api/kit/text?path=${encodeURIComponent(path ?? '')}`),
  enabled: !!path, refetchInterval,
});

/**
 * Whether tests/login.ts has been written for this app: pending only until the first answer. A project with no
 * login.ts yet answers "not written" instead of an error: an error was retried and refetched every 5 s, each time
 * going back to loading, which made "Set up is not finished" open and close by itself on a new project.
 */
export function useLoginWritten() {
  const q = useQuery({
    queryKey: ['kittext', 'tests/login.ts'], refetchInterval: 5000, retry: false,
    queryFn: () => api.get<{ text: string }>('/api/kit/text?path=tests%2Flogin.ts').catch(() => ({ text: LOGIN_TEMPLATE })),
  });
  return { pending: q.isPending, written: !!q.data && !q.data.text.includes(LOGIN_TEMPLATE) };
}

/**
 * After an answer, a stop or a delete: refresh what may have changed, but not the machine check. It runs every
 * requirement check again (seconds of work), and one that fails for a moment while a run is busy made the
 * home page's "Set up is not finished" open and close by itself. The Setup page refreshes it after a fix.
 */
export const refreshAfterAction = (qc: QueryClient) => qc.invalidateQueries({ predicate: q => q.queryKey[0] !== 'setup' });
