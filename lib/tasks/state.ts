import type { CodeReviewSection } from "./code-review";

export type TaskStatus = "running" | "merged" | "dropped" | "done";

export type ChecksVerdict = "pass" | "fail" | "pending" | "none";

export interface TaskPR {
  number: number;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  checks: ChecksVerdict;
  // The head commit the checks ran on, and the first failing check's name.
  head?: string;
  failing?: string | null;
  // How many checks are registered on the head.
  checkCount?: number;
  // The body's Code review section: null when it has none, undefined
  // when the body wasn't read.
  codeReview?: CodeReviewSection | null;
}

export type TaskState =
  | "working"
  | "needs-input"
  | "blocked"
  | "review"
  | "checks-failing"
  | "exited"
  | "merged"
  | "dropped"
  | "done";

export interface TaskStateInput {
  taskStatus: TaskStatus;
  // From the tmux status detector; "dead" when the session is gone.
  sessionStatus: "running" | "waiting" | "idle" | "error" | "dead" | undefined;
  pr: TaskPR | null;
  blocked: boolean;
}

// Ordered by what needs the human first.
export function deriveTaskState(input: TaskStateInput): TaskState {
  const { taskStatus, sessionStatus, pr, blocked } = input;
  if (taskStatus === "merged" || pr?.state === "MERGED") return "merged";
  if (taskStatus === "dropped") return "dropped";
  if (taskStatus === "done") return "done";
  if (blocked) return "blocked";
  if (pr?.state === "OPEN") {
    return pr.checks === "fail" ? "checks-failing" : "review";
  }
  if (!sessionStatus || sessionStatus === "dead") return "exited";
  if (sessionStatus === "running") return "working";
  return "needs-input";
}

export const isFinished = (state: TaskState) =>
  state === "merged" || state === "dropped" || state === "done";

export function needsHuman(state: TaskState): boolean {
  return [
    "needs-input",
    "blocked",
    "review",
    "checks-failing",
    "exited",
  ].includes(state);
}

export function canSignOff(pr: TaskPR | null): {
  ok: boolean;
  reason?: string;
} {
  if (!pr) return { ok: false, reason: "No pull request yet" };
  if (pr.state !== "OPEN")
    return { ok: false, reason: `PR is ${pr.state.toLowerCase()}` };
  if (pr.checks === "fail")
    return { ok: false, reason: "CI checks are failing" };
  if (pr.checks === "pending")
    return { ok: false, reason: "CI checks are still running" };
  return { ok: true };
}

type RollupEntry = {
  __typename?: string | null;
  workflowName?: string | null;
  name?: string | null;
  context?: string | null;
  conclusion?: string | null;
  state?: string | null;
  status?: string | null;
};

const FAILED = ["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED"];

const outcome = (c: RollupEntry) =>
  (c.conclusion || c.state || c.status || "").toUpperCase();

// Job names repeat across workflows, and a status context can share a check
// run's name, so a check is its kind, workflow and name together.
const checkKey = (c: RollupEntry) => {
  const name = c.name ?? c.context;
  return name ? `${c.__typename ?? ""}|${c.workflowName ?? ""}|${name}` : null;
};

// A concurrency group cancels the stale run on the same sha, so a CANCELLED
// entry says nothing when the same check also has a run that wasn't cancelled.
function liveChecks<T extends RollupEntry>(rollup: T[]): T[] {
  const ran = new Set(
    rollup.filter((c) => outcome(c) !== "CANCELLED").map(checkKey)
  );
  return rollup.filter((c) => {
    const key = checkKey(c);
    return outcome(c) !== "CANCELLED" || key === null || !ran.has(key);
  });
}

// Summarise gh's statusCheckRollup into one verdict. A lone CANCELLED run is
// pending: it is waiting on a rerun, not a failure.
export function checksVerdict(rollup: RollupEntry[]): ChecksVerdict {
  if (!rollup.length) return "none";
  const outcomes = liveChecks(rollup).map(outcome);
  if (outcomes.some((o) => FAILED.includes(o))) return "fail";
  if (
    outcomes.some((o) =>
      [
        "",
        "PENDING",
        "QUEUED",
        "IN_PROGRESS",
        "EXPECTED",
        "WAITING",
        "CANCELLED",
      ].includes(o)
    )
  )
    return "pending";
  return "pass";
}

const BLOCKED_LINE = /^\s*[⏺●•]?\s*BLOCKED:\s*(.*)$/m;

export function isBlocked(paneTail: string): boolean {
  return BLOCKED_LINE.test(paneTail);
}

// What the agent said it needs, from its last BLOCKED: line.
export function blockedReason(paneTail: string): string | null {
  const lines = paneTail.split("\n").filter((l) => BLOCKED_LINE.test(l));
  const last = lines.at(-1);
  return last ? (BLOCKED_LINE.exec(last)?.[1].trim() ?? "") : null;
}

// The first failing check in gh's statusCheckRollup, by name.
export function failingCheck(rollup: RollupEntry[]): string | null {
  const c = liveChecks(rollup).find((r) => FAILED.includes(outcome(r)));
  return c ? (c.name ?? c.context ?? null) : null;
}

// Keys that answer Claude's folder-trust prompt with "trust", or null when the
// pane isn't showing it. The selection marker starts on "No, exit".
export function trustPromptKeys(pane: string): string[] | null {
  if (!/yes, i trust this folder/i.test(pane)) return null;
  const selected = pane.split("\n").find((l) => l.includes("❯")) ?? "";
  return /trust/i.test(selected) ? ["Enter"] : ["Down", "Enter"];
}
