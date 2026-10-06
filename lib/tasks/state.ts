export type TaskStatus = "running" | "merged" | "dropped";

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
}

export type TaskState =
  | "working"
  | "needs-input"
  | "blocked"
  | "review"
  | "checks-failing"
  | "exited"
  | "merged"
  | "dropped";

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
  if (blocked) return "blocked";
  if (pr?.state === "OPEN") {
    return pr.checks === "fail" ? "checks-failing" : "review";
  }
  if (!sessionStatus || sessionStatus === "dead") return "exited";
  if (sessionStatus === "running") return "working";
  return "needs-input";
}

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

// Summarise gh's statusCheckRollup into one verdict.
export function checksVerdict(
  rollup: Array<{
    conclusion?: string | null;
    state?: string | null;
    status?: string | null;
  }>
): ChecksVerdict {
  if (!rollup.length) return "none";
  const outcomes = rollup.map((c) =>
    (c.conclusion || c.state || c.status || "").toUpperCase()
  );
  if (
    outcomes.some((o) =>
      [
        "FAILURE",
        "ERROR",
        "TIMED_OUT",
        "CANCELLED",
        "ACTION_REQUIRED",
      ].includes(o)
    )
  )
    return "fail";
  if (
    outcomes.some((o) =>
      ["", "PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING"].includes(
        o
      )
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
export function failingCheck(
  rollup: Array<{
    name?: string | null;
    context?: string | null;
    conclusion?: string | null;
    state?: string | null;
  }>
): string | null {
  const bad = ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"];
  const c = rollup.find((r) =>
    bad.includes((r.conclusion || r.state || "").toUpperCase())
  );
  return c ? (c.name ?? c.context ?? null) : null;
}

// Keys that answer Claude's folder-trust prompt with "trust", or null when the
// pane isn't showing it. The selection marker starts on "No, exit".
export function trustPromptKeys(pane: string): string[] | null {
  if (!/yes, i trust this folder/i.test(pane)) return null;
  const selected = pane.split("\n").find((l) => l.includes("❯")) ?? "";
  return /trust/i.test(selected) ? ["Enter"] : ["Down", "Enter"];
}
