/**
 * A task's PR checks for the phone: each check's name, state, link and
 * duration, the tail of a failing Actions job's log (the same one AgentOS
 * sends a task when its CI fails), and the review gate's verdict on the head.
 * Log and verdict text is untrusted: displayed, never run.
 */

import { getCheck } from "../orchestrator/checks";
import { restackedOf } from "../orchestrator/signoff";
import { run, settledRollup } from "./gh";
import { failedLog, repoOfPR, type FailedLog } from "./pr-activity";
import { prFor, projectPathFor, storedPR } from "./session";
import type { RollupEntry } from "./state";
import {
  CHECK_LOGS_MAX,
  CHECK_LOG_MAX_BYTES,
  parseReviewDetail,
  type CheckState,
  type TaskCheck,
  type TaskChecks,
  type TaskReviewVerdict,
} from "./loop-types";
import type { Session } from "../db";

const outcome = (c: RollupEntry) =>
  (c.conclusion || c.state || c.status || "").toUpperCase();

export function checkState(c: RollupEntry): CheckState {
  switch (outcome(c)) {
    case "SUCCESS":
      return "pass";
    case "FAILURE":
    case "ERROR":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
      return "fail";
    case "SKIPPED":
      return "skipped";
    case "CANCELLED":
      return "cancelled";
    case "NEUTRAL":
    case "STALE":
      return "neutral";
    default:
      return "pending";
  }
}

// gh gives a run not finished yet a zero completedAt (0001-01-01).
const time = (t?: string | null) => {
  const ms = Date.parse(t || "");
  return ms > 0 ? ms : null;
};
const iso = (t?: string | null) => {
  const ms = time(t);
  return ms === null ? null : new Date(ms).toISOString();
};

// A status context can carry any URL; only a web one is a link.
const httpsUrl = (u?: string | null) =>
  u && /^https:\/\/[^\s]+$/.test(u) ? u : null;

export function toTaskChecks(rollup: RollupEntry[]): TaskCheck[] {
  return rollup.map((c) => {
    const start = time(c.startedAt);
    const end = time(c.completedAt);
    return {
      name: c.name ?? c.context ?? "(unnamed)",
      workflow: c.workflowName || null,
      state: checkState(c),
      conclusion: (c.conclusion || c.state || null)?.toLowerCase() ?? null,
      url: httpsUrl(c.detailsUrl),
      startedAt: iso(c.startedAt),
      completedAt: iso(c.completedAt),
      durationSec:
        start !== null && end !== null && end >= start
          ? Math.round((end - start) / 1000)
          : null,
    };
  });
}

// A finished job's log never changes.
const logCache = new Map<string, FailedLog | null>();
const LOG_CACHE_MAX = 200;
export const resetLogCache = () => logCache.clear();

export interface ChecksDeps {
  failedLog: typeof failedLog;
}

export async function taskChecks(
  session: Session,
  opts: { logs?: boolean; deps?: ChecksDeps } = {}
): Promise<TaskChecks> {
  const deps = opts.deps ?? { failedLog };
  const dir = projectPathFor(session);
  const live = session.task_status === "running";
  const pr = dir
    ? live
      ? await prFor(session).catch(() => null)
      : storedPR(session)
    : null;
  if (!pr || !dir) return { pr: null, checks: [], review: null };
  const head = pr.head ?? null;

  let checks: TaskCheck[] = [];
  let rollup: RollupEntry[] = [];
  try {
    const out = JSON.parse(
      await run(
        "gh",
        [
          "pr",
          "view",
          String(pr.number),
          "--json",
          "headRefOid,statusCheckRollup",
        ],
        dir,
        20000
      )
    ) as { headRefOid?: string; statusCheckRollup?: RollupEntry[] | null };
    rollup = out.statusCheckRollup ?? [];
    if (pr.state === "OPEN")
      rollup = await settledRollup(dir, pr.url, out.headRefOid, rollup);
    checks = toTaskChecks(rollup);
  } catch (error) {
    console.error(`Reading ${session.name}'s checks:`, error);
  }

  const repo = repoOfPR(pr.url);
  if (opts.logs !== false && repo) {
    const failing = checks
      .map((c, i) => ({ c, url: c.state === "fail" ? c.url : null, i }))
      .filter((x) => x.url)
      .slice(0, CHECK_LOGS_MAX);
    await Promise.all(
      failing.map(async ({ c, url }) => {
        let log = logCache.get(url!);
        if (log === undefined) {
          log = await deps.failedLog(dir, repo, url).catch((error) => {
            console.error(`Reading ${session.name}'s CI log:`, error);
            return null;
          });
          if (log) {
            if (logCache.size >= LOG_CACHE_MAX) logCache.clear();
            logCache.set(url!, log);
          }
        }
        if (log) {
          const tail = log.tail.slice(-CHECK_LOG_MAX_BYTES);
          c.log = {
            step: log.step,
            tail,
            truncated: tail.length < log.tail.length,
          };
        }
      })
    );
  }

  return {
    pr: { number: pr.number, url: pr.url, state: pr.state, head },
    checks,
    review: head ? reviewVerdict(session, head) : null,
  };
}

// The review covering the head: its own, or the one of the head the task
// pushed while the head is exactly the one AgentOS restacked it to.
export function reviewVerdict(
  session: Session,
  head: string
): TaskReviewVerdict | null {
  const restacked = restackedOf(session);
  const row =
    getCheck(session.id, head, "review") ??
    (restacked?.to === head && restacked.from
      ? getCheck(session.id, restacked.from, "review")
      : null);
  if (!row) return null;
  const { summary, findings, truncated } = parseReviewDetail(row.detail);
  return {
    sha: row.sha,
    status: row.status,
    summary,
    findings,
    at: row.created_at,
    truncated,
  };
}
