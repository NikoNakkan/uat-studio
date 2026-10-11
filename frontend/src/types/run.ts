// The data of one run, as GET /api/runs/{id} returns it: each field is one JSON file of the run's folder
// (runs/<id>/<name>.json, dashes as underscores), null while that file does not exist yet.

export type Step = { n: number; text: string };
export type Expected = { step: number | string; text: string };
export type Case = {
  test_id: string; group: string; title: string; row?: number; start_page?: string; login_as?: string;
  steps: Step[]; expected_results: Expected[]; automation?: string;
  clarified?: boolean; open_questions?: boolean; carried_from?: string;
};

export type StageStatus = { status: string; note?: string; at?: string };
export type ProgressTest = { result: string; file?: string; error?: string; evidence?: string; duration_ms?: number; at?: string };
export type Progress = {
  run_id?: string; excel?: string; excel_sha256?: string; strictness?: string;
  stages?: Record<string, StageStatus>; tests?: Record<string, ProgressTest>;
};

export type CaseChange = { status: string; decision?: string; fields_changed?: string[]; wording_only_candidate?: boolean; similar_to?: string };
export type TestCheckFile = { test_id: string; ok: boolean; problems: string[] };
export type Flaky = { runs: number; passed: number; verdict: string };

export type CheckedTest = {
  group: string; title: string; row?: number; result: string; recommendation: string; manual?: boolean;
  screenshots?: string; trace?: boolean; evidence?: string; reasons?: string[]; missing?: string[]; cause?: string;
};
export type SignoffUnit = { tests: string[]; recommendation: string; manual?: string[] };
export type EvidenceCheck = { sign_off_unit: string; tests: Record<string, CheckedTest>; units: Record<string, SignoffUnit> };

export type Diagnosis = { cause?: string; summary?: string; error?: string; reproduction?: string; reproduction_detail?: string; repair?: string };
export type ConsoleGroup = { message: string; kind: string; where: { test_id: string; step: string | number }[]; in_failing_test: boolean; count: number };
export type ConsoleNew = { groups: ConsoleGroup[]; captured: number; ignored_as_noise: number };
export type ScreenPair = { test_id: string; step: number; name?: string; status?: string; changed_pixels?: number };
export type Screens = { baseline_run?: string | null; pairs?: ScreenPair[]; flagged?: ScreenPair[] };
export type UsageRow = { stage: string; agent: string; model: string; input_tokens: number; output_tokens: number; source: string; at?: string };

export type Decision = { decision: string; by: string; reason?: string; date?: string; ai_recommendation?: string };
export type ManualResult = { result: string; by: string; note?: string; evidence?: string; date?: string };
export type Signoff = { decisions: Record<string, Decision>; manual?: Record<string, ManualResult>; complete?: boolean };

export type RunData = {
  progress: Progress | null;
  cases: Case[] | null;
  changes: { cases: Record<string, CaseChange> } | null;
  generate_list: { test_id: string }[] | null;
  test_check: { files: Record<string, TestCheckFile> } | null;
  flakiness: Record<string, Flaky> | null;
  evidence_check: EvidenceCheck | null;
  diagnoses: Record<string, Diagnosis> | null;
  console_new: ConsoleNew | null;
  screens: Screens | null;
  usage: UsageRow[] | null;
  signoff: Signoff | null;
  manifest: { sealed_at: string; files: Record<string, string> } | null;
  studio_reasoning: Record<string, string> | null;
  studio_validation: { output?: string } | null;
};
