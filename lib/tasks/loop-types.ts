/**
 * The shapes the building-loop endpoints answer with (start options, a
 * task's diff, its checks and review verdict, its plan), plus their caps.
 * Pure data, no imports, so the native app can sync this file on its own.
 * Every string that came from a log, a review or a plan is untrusted text
 * to display, never to run.
 */

export const DIFF_MAX_FILES = 300;
export const DIFF_PATCH_MAX_BYTES = 200_000;
export const CHECK_LOG_MAX_BYTES = 8_000;
export const CHECK_LOGS_MAX = 3;
export const REVIEW_DETAIL_MAX = 20_000;
export const REVIEW_FINDINGS_MAX = 50;
export const PLAN_TEXT_MAX = 4_000;

// -- Start options ---------------------------------------------------------

export interface StartAgent {
  value: string;
  label: string;
  // On this machine; null when the project runs on another machine.
  installed: boolean | null;
  auth: string | null;
  hint: string | null;
  models: { value: string; label: string }[];
  defaultModel: string;
}

export interface StartHost {
  id: string;
  name: string;
  linked: boolean;
  // Why a project here can't go to this machine, when it can't.
  unavailable: string | null;
}

export interface TaskModelChoice {
  ref: string;
  label: string;
  provider: string;
}

export interface StartOptions {
  project: {
    id: string;
    name: string;
    agentType: string;
    defaultModel: string;
    hostId: string;
  } | null;
  agents: StartAgent[];
  // "provider/model" refs a task can run on, and the role defaults.
  taskModels: TaskModelChoice[];
  roles: { plan: string; implement: string };
  planDefault: boolean;
  planError: string | null;
  hosts: StartHost[];
  git: {
    isGitRepo: boolean;
    defaultBranch: string | null;
    currentBranch: string | null;
    branches: string[];
  } | null;
}

// -- A task's whole change -------------------------------------------------

export interface TaskDiffFile {
  path: string;
  // git's letters: A added, M modified, D deleted, R renamed, C copied,
  // T type changed.
  status: string;
  // null for a binary file.
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export interface TaskDiffList {
  source: "worktree" | "pr";
  base: string;
  head: string;
  files: TaskDiffFile[];
  totalFiles: number;
  additions: number;
  deletions: number;
  truncated: boolean;
}

export interface TaskDiffPatch {
  source: "worktree" | "pr";
  path: string;
  patch: string | null;
  truncated: boolean;
  // No patch to show: binary, or too big for git or GitHub to give.
  tooLarge: boolean;
}

// -- Checks and the review verdict ----------------------------------------

export type CheckState =
  "pass" | "fail" | "pending" | "skipped" | "cancelled" | "neutral";

export interface TaskCheck {
  name: string;
  workflow: string | null;
  state: CheckState;
  conclusion: string | null;
  url: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationSec: number | null;
  // The failed step's log around its error, for a failing Actions job.
  log?: { step: string | null; tail: string; truncated: boolean };
}

export interface ReviewFinding {
  severity: string;
  file: string | null;
  line: number | null;
  summary: string;
}

export interface TaskReviewVerdict {
  sha: string;
  status: "running" | "pass" | "block" | "error";
  summary: string;
  findings: ReviewFinding[];
  at: string;
  truncated: boolean;
}

export interface TaskChecks {
  pr: {
    number: number;
    url: string;
    state: string;
    head: string | null;
  } | null;
  checks: TaskCheck[];
  review: TaskReviewVerdict | null;
}

// -- A task's plan ---------------------------------------------------------

export interface PlanPieceView {
  position: number;
  name: string;
  slice: string;
  project: string;
  afterPosition: number | null;
  afterKind: "merged" | "deployed" | null;
  reasons: string[];
  owns: string[];
  // Merging into the piece before would break why it was split (a).
  forced: boolean;
  // Saad's pending edit, applied at approval.
  edit: "merge" | "drop" | null;
}

export interface PlanPiecesView {
  pieces: PlanPieceView[];
  folded: { name: string; into: number; why: string }[];
  warnings: string[];
}

export interface TaskPlan {
  // Set once a plan waits for approval: how the checker split it.
  pieces?: PlanPiecesView | null;
  // As the starter decided (null reason when unstated).
  planned: boolean;
  reason: string | null;
  // null: no plan document yet.
  status: "writing" | "ready" | "approved" | null;
  source: "step" | "chat" | null;
  title: string | null;
  // Relative to the task's worktree.
  path: string | null;
  text: string | null;
  truncated: boolean;
}

// Splits a stored review detail (lib/orchestrator/review-prompt.ts writes
// "summary" then "- [severity] file:line: text" lines) back into a summary and
// findings. A line that isn't a finding stays in the summary.
const FINDING = /^- \[([^\]\n]{1,40})\](?: ([^\s:]+)(?::(\d+))?)?: (.*)$/;

export function parseReviewDetail(detail: string | null | undefined): {
  summary: string;
  findings: ReviewFinding[];
  truncated: boolean;
} {
  let truncated = false;
  let text = detail ?? "";
  if (text.length > REVIEW_DETAIL_MAX) {
    text = text.slice(0, REVIEW_DETAIL_MAX);
    truncated = true;
  }
  const summary: string[] = [];
  const findings: ReviewFinding[] = [];
  for (const line of text.split("\n")) {
    const m = FINDING.exec(line);
    if (!m) {
      summary.push(line);
      continue;
    }
    if (findings.length >= REVIEW_FINDINGS_MAX) {
      truncated = true;
      continue;
    }
    findings.push({
      severity: m[1],
      file: m[2] ?? null,
      line: m[3] ? Number(m[3]) : null,
      summary: m[4],
    });
  }
  return { summary: summary.join("\n").trim(), findings, truncated };
}
