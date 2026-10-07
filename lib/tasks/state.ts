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

export type RollupEntry = {
  __typename?: string | null;
  workflowName?: string | null;
  name?: string | null;
  context?: string | null;
  conclusion?: string | null;
  state?: string | null;
  status?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  detailsUrl?: string | null;
};

const FAILED = ["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED"];
const UNFINISHED = [
  "",
  "PENDING",
  "QUEUED",
  "IN_PROGRESS",
  "EXPECTED",
  "WAITING",
];

const outcome = (c: RollupEntry) =>
  (c.conclusion || c.state || c.status || "").toUpperCase();

// Job names repeat across workflows, and a status context can share a check
// run's name, so a check is its kind, workflow and name together.
const checkKey = (c: RollupEntry) => {
  const name = c.name ?? c.context;
  return name ? `${c.__typename ?? ""}|${c.workflowName ?? ""}|${name}` : null;
};

// A time from the rollup, or null. gh gives a run not finished yet a zero
// completedAt (0001-01-01), so only a time after the epoch counts.
const at = (time?: string | null) => {
  const t = Date.parse(time || "");
  return t > 0 ? t : null;
};

// A concurrency group cancels the stale run on the same sha, so a CANCELLED
// entry says nothing when the same check also has a run that wasn't cancelled.
// Every other run counts here: settleReruns decides which reruns are stale.
function liveChecks<T extends RollupEntry>(rollup: T[]): T[] {
  const ran = new Set(
    rollup.filter((c) => outcome(c) !== "CANCELLED").map(checkKey)
  );
  return rollup.filter((c) => {
    const key = checkKey(c);
    return outcome(c) !== "CANCELLED" || key === null || !ran.has(key);
  });
}

// What the Actions API says started a workflow run (its latest attempt).
export type ActionsRun = {
  event: string;
  headSha: string;
  startedAt: string;
  workflowId: number;
};

const ACTIONS_RUN =
  /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/actions\/runs\/(\d+)(?:[/?#]|$)/;

// The Actions workflow run behind a check run, from its details URL.
export function actionsRunOf(
  c: RollupEntry
): { repo: string; id: string } | null {
  if (c.__typename !== "CheckRun") return null;
  const m = ACTIONS_RUN.exec(c.detailsUrl ?? "");
  return m ? { repo: `${m[1]}/${m[2]}`, id: m[3] } : null;
}

const groupByCheck = <T extends RollupEntry>(rollup: T[]) => {
  const groups = new Map<string, T[]>();
  for (const c of rollup) {
    const key = checkKey(c);
    if (key) groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return groups;
};

// The Actions runs settleReruns needs: only checks that ran more than once.
// `attempt` names what the rollup shows of a run: the latest start of its
// jobs, which a rerun changes. It is null while any of its jobs hasn't
// started, when the rollup can't tell one attempt from the next.
export function rerunsToLookUp(
  rollup: RollupEntry[]
): Array<{ repo: string; id: string; attempt: string | null }> {
  const wanted = new Set<string>();
  for (const group of groupByCheck(rollup).values()) {
    if (group.length < 2) continue;
    for (const c of group) {
      const run = actionsRunOf(c);
      if (run) wanted.add(`${run.repo}#${run.id}`);
    }
  }
  const runs = new Map<
    string,
    { repo: string; id: string; attempt: string | null }
  >();
  for (const c of rollup) {
    const run = actionsRunOf(c);
    const key = run && `${run.repo}#${run.id}`;
    if (!run || !key || !wanted.has(key)) continue;
    const started = at(c.startedAt);
    const seen = runs.get(key);
    const latest =
      seen === undefined
        ? started
        : seen.attempt === null || started === null
          ? null
          : Math.max(Number(seen.attempt), started);
    runs.set(key, {
      ...run,
      attempt: latest === null ? null : String(latest),
    });
  }
  return [...runs.values()];
}

const PR_EVENTS = ["pull_request", "pull_request_target"];

// Drop the runs of a check that a later pull_request run replaced: a rerun,
// or a run started by an edited PR body or a push to the branch. gh's rollup
// doesn't say what started a run, so `runs` (from the Actions API, keyed
// "owner/repo#id") does. A run for another commit never counts. A push run
// never replaces anything, so its failure stands until a pull_request run
// starts after it. When the API couldn't answer, or the answer is ambiguous,
// the check is not settled yet: it reads as pending, never as passing.
export function settleReruns<T extends RollupEntry>(
  rollup: T[],
  head: string | null | undefined,
  runs: Map<string, ActionsRun | null>
): RollupEntry[] {
  const drop = new Set<RollupEntry>();
  const unsettled: RollupEntry[] = [];
  for (const group of groupByCheck(rollup).values()) {
    if (group.length < 2) continue;
    const located = group.map((c) => ({ c, run: actionsRunOf(c) }));
    // Not all GitHub Actions: nothing says which run is stale, so all count.
    if (located.some((l) => !l.run)) continue;
    const stale = staleRuns(
      located.map((l) => ({
        c: l.c,
        id: l.run!.id,
        info: runs.get(`${l.run!.repo}#${l.run!.id}`) ?? null,
      })),
      head
    );
    if (stale) {
      for (const c of stale) drop.add(c);
    } else {
      for (const c of group) drop.add(c);
      const { __typename, workflowName, name, context } = group[0];
      unsettled.push({
        __typename,
        workflowName,
        name,
        context,
        status: "PENDING",
      });
    }
  }
  return [...rollup.filter((c) => !drop.has(c)), ...unsettled];
}

// The runs of one check that don't count, or null when that can't be told.
function staleRuns(
  runs: Array<{ c: RollupEntry; id: string; info: ActionsRun | null }>,
  head: string | null | undefined
): RollupEntry[] | null {
  if (!head || runs.some((r) => !r.info)) return null;
  // Workflows can share a display name; only one workflow's runs compare.
  if (new Set(runs.map((r) => r.info!.workflowId)).size > 1) return null;
  // A run on another commit never vouches for the head, but a failure the
  // head's rollup shows can't be explained away by it either: wait.
  const foreign = runs.filter((r) => r.info!.headSha !== head);
  if (foreign.some((r) => outcome(r.c) !== "SUCCESS")) return null;
  const mine = runs.filter((r) => r.info!.headSha === head);
  if (!mine.length || new Set(mine.map((r) => r.id)).size < mine.length)
    return null;
  const timed = mine.map((r) => ({ ...r, at: at(r.info!.startedAt) }));
  if (timed.some((r) => r.at === null)) return null;
  // Only a run that passed, failed or is still going says anything about the
  // check; a cancelled, skipped or neutral run replaces nothing.
  const pr = timed.filter(
    (r) =>
      PR_EVENTS.includes(r.info!.event) &&
      ["SUCCESS", ...FAILED, ...UNFINISHED].includes(outcome(r.c))
  );
  const newest = pr.length ? Math.max(...pr.map((r) => r.at!)) : -Infinity;
  if (pr.filter((r) => r.at === newest).length > 1) return null;
  return runs
    .filter((r) => !timed.some((t) => t.c === r.c && t.at! >= newest))
    .map((r) => r.c);
}

// Summarise gh's statusCheckRollup into one verdict. A lone CANCELLED run is
// pending: it is waiting on a rerun, not a failure.
export function checksVerdict(rollup: RollupEntry[]): ChecksVerdict {
  if (!rollup.length) return "none";
  const outcomes = liveChecks(rollup).map(outcome);
  if (outcomes.some((o) => FAILED.includes(o))) return "fail";
  if (outcomes.some((o) => [...UNFINISHED, "CANCELLED"].includes(o)))
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
