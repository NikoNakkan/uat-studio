import type { RunData } from './types/run';

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
  del: <T,>(url: string) => call<T>('DELETE', url),
};

export type Question = { id: string; test_id?: string; text: string; recommended?: string };
/** What an open question, confirmation or approval carries; which fields are set depends on its kind. */
export type InteractionPayload = {
  agent?: string; questions?: Question[]; can_defer?: boolean;                     // question
  options?: string[]; suggestion?: string; explanation?: string; status?: string;  // change, proceed, setup
  details?: { fields_changed?: string[]; similar_to?: string };
  reason?: string; tool?: string; input?: unknown;                                 // guard
  summary?: string; output?: string; text?: string;                                // repair, setup
};
export type Interaction = { id: string; channel: string; kind: string; title: string; payload: InteractionPayload; created: number };
export type StageRow = { id: string; feature: string; on: boolean; agent?: string; does: string; stop_for_person?: string;
  status: string; note: string; at?: string };
/** Where a run stands, in one word (computed by the server). */
export type RunState = 'running' | 'waiting' | 'signed_off' | 'stopped' | 'finished' | 'not_started';
export type RunSummary = { id: string; excel: string | null; created: string | null; strictness: string | null; cases: number;
  stages_done: number; stages_total: number; current: string | null; current_status: string | null;
  tests: number; passed: number; failed: number; sealed: boolean; results: boolean; running: boolean; waiting: number; state: RunState;
  cost: number; screens: boolean; baseline: 'chosen' | 'latest' | null };
export type RunDetail = { id: string; data: RunData; texts: Record<string, string>; folders: string[];
  stages: StageRow[]; running: boolean; pending: Interaction[]; results_ready: boolean; cost: RunCost };
/** One line of a cost breakdown: a stage, agent or model, what it cost in US dollars and how many agent calls. */
export type CostItem = { key: string; cost: number; calls: number; input: number; output: number };
/** What a run cost. estimated: some usage was recorded before cached tokens were counted apart, so it is the most it cost. */
export type RunCost = { total: number; calls: number; estimated: boolean; unpriced: string[];
  tokens: { input: number; output: number; cache_read: number; cache_write: number };
  by_stage: CostItem[]; by_agent: CostItem[]; by_model: CostItem[] };
export type Event = { seq: number; ts: number; type: string; stage?: string; agent?: string; tool?: string; script?: string;
  text?: string; input?: string; code?: number; status?: string; note?: string; reason?: string; interaction?: Interaction;
  model?: string; input_tokens?: number; output_tokens?: number; is_error?: boolean; images?: number; turns?: number };

export const runFile = (runId: string, path: string) => `/api/runs/${runId}/file?path=${encodeURIComponent(path)}`;
export const kitFile = (path: string) => `/api/kit/file?path=${encodeURIComponent(path)}`;

/** An agent's job and the model recommended for it (the default until the person chooses another). */
export type AgentInfo = { job: string; recommended: string; why: string };
/** A model a person can choose; price is US dollars per million input / output tokens. */
export type ModelChoice = { id: string; name: string; price: string; use: string };
export type Settings = { api_key_set: boolean; api_key_hint: string; api_key_from_env?: boolean; models: Record<string, string>;
  agents: Record<string, AgentInfo>; default_model: string; model_choices: ModelChoice[]; max_turns: number; max_output_tokens: number;
  show_agent_browser: boolean; kit_dir: string };
export type SetupRow = { status: string; item: string; fix: string };
export type SetupCheck = { ok: boolean; rows: SetupRow[]; output: string };
export type Account = { name: string; label: string; user: string; user_set: boolean; password_set: boolean; used_by: string[] };
export type EnvInfo = { env_exists: boolean; start_page: string; accounts: Account[]; allowed_origins: string[] };
export type Health = { ok: boolean; kit: string; kit_found: boolean; running: string[]; project: string };

/** What testing the app by hand costs: a person's hourly rate (null until entered) and the hours it takes. */
export type Savings = { hourly_rate: number | null; manual_hours: number };
export type Project = { id: string; name: string; dir: string; current: boolean; runs: number; running: string[]; created: string;
  savings: Savings; baseline_run: string | null };
export type Projects = { current: string; projects: Project[] };
