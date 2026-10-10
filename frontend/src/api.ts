// Thin client for the FastAPI back end. Errors carry the server's own message.
export class ApiError extends Error {}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(typeof data?.detail === 'string' ? data.detail : JSON.stringify(data?.detail ?? res.statusText));
  return data as T;
}

export const api = {
  get: <T,>(url: string) => call<T>('GET', url),
  post: <T,>(url: string, body?: unknown) => call<T>('POST', url, body ?? {}),
  put: <T,>(url: string, body?: unknown) => call<T>('PUT', url, body ?? {}),
};

export type Interaction = { id: string; channel: string; kind: string; title: string; payload: any; created: number };
export type StageRow = { id: string; feature: string; on: boolean; agent?: string; does: string; stop_for_person?: string;
  status: string; note: string; at?: string };
export type RunSummary = { id: string; excel: string; created: string; strictness: string; stages_done: number; stages_total: number;
  current: string | null; tests: number; passed: number; sealed: boolean; results: boolean; running: boolean; waiting: number };
export type RunDetail = { id: string; data: Record<string, any>; texts: Record<string, string>; folders: string[];
  stages: StageRow[]; running: boolean; pending: Interaction[]; results_ready: boolean };
export type Event = { seq: number; ts: number; type: string; stage?: string; agent?: string; tool?: string; script?: string;
  text?: string; input?: string; code?: number; status?: string; note?: string; reason?: string; interaction?: Interaction;
  model?: string; input_tokens?: number; output_tokens?: number; is_error?: boolean; images?: number; turns?: number };

export const runFile = (runId: string, path: string) => `/api/runs/${runId}/file?path=${encodeURIComponent(path)}`;
export const kitFile = (path: string) => `/api/kit/file?path=${encodeURIComponent(path)}`;
