/**
 * Quality of the work that merged, from data AgentOS already keeps (the
 * orchestrator's checks, gate failures, asks and brief amendments) and, for
 * escapes, the merged PR list from gh. No model is involved.
 */

import { db } from "../db";
import { run as runCmd } from "../tasks/gh";

export interface MergedTask {
  id: string;
  projectId: string | null;
  prNumber: number | null;
  mergedAt: string;
}

export interface TaskQuality {
  id: string;
  reviewed: boolean;
  clean: boolean;
  // Heads checked after the first reviewed one.
  fixRounds: number;
  gateFailures: number;
}

export interface DayQuality {
  merged: number;
  clean: number;
  fixRounds: number;
  escalations: number;
  scopeChanges: number;
  // Null when gh couldn't say.
  escapes: number | null;
}

interface CheckRow {
  id: number;
  session_id: string;
  sha: string;
  kind: string;
  status: string;
}

// Clean: the first reviewed head passed review and CI, nothing failed a
// gate, and no later head was checked. A merge with no review at all isn't
// clean: it can't be told apart from one that skipped the gate.
export function taskQuality(
  id: string,
  checks: CheckRow[],
  gateFailures: number
): TaskQuality {
  const mine = checks
    .filter((c) => c.session_id === id)
    .sort((a, b) => a.id - b.id);
  const first = mine.find(
    (c) => c.kind === "review" && (c.status === "pass" || c.status === "block")
  );
  if (!first)
    return { id, reviewed: false, clean: false, fixRounds: 0, gateFailures };
  const ci = mine.find((c) => c.kind === "ci" && c.sha === first.sha);
  const later = new Set(
    mine.filter((c) => c.id > first.id && c.sha !== first.sha).map((c) => c.sha)
  );
  return {
    id,
    reviewed: true,
    clean:
      first.status === "pass" &&
      ci?.status === "pass" &&
      gateFailures === 0 &&
      later.size === 0,
    fixRounds: later.size,
    gateFailures,
  };
}

const sqlTime = (ms: number) =>
  new Date(ms).toISOString().slice(0, 19).replace("T", " ");

export function mergedTasks(from: number, to: number): MergedTask[] {
  return (
    db
      .prepare(
        `SELECT id, project_id AS projectId, pr_number AS prNumber, merged_at AS mergedAt
         FROM sessions WHERE task_status = 'merged' AND merged_at >= ? AND merged_at < ?`
      )
      .all(sqlTime(from), sqlTime(to)) as MergedTask[]
  ).filter((t) => t.mergedAt);
}

export function qualityOf(tasks: MergedTask[]): TaskQuality[] {
  if (!tasks.length) return [];
  const marks = tasks.map(() => "?").join(",");
  const ids = tasks.map((t) => t.id);
  const checks = db
    .prepare(
      `SELECT id, session_id, sha, kind, status FROM orchestrator_checks
       WHERE session_id IN (${marks})`
    )
    .all(...ids) as CheckRow[];
  const gates = new Map(
    (
      db
        .prepare(
          `SELECT session_id, SUM(count) AS n FROM orchestrator_gate_failures
           WHERE session_id IN (${marks}) GROUP BY session_id`
        )
        .all(...ids) as { session_id: string; n: number }[]
    ).map((g) => [g.session_id, g.n])
  );
  return tasks.map((t) => taskQuality(t.id, checks, gates.get(t.id) ?? 0));
}

// Escalations to Saad in the range: gates that gave up on a task, and gate
// asks, counted once per task.
export function escalationsIn(from: number, to: number): number {
  const f = sqlTime(from);
  const t = sqlTime(to);
  const rows = db
    .prepare(
      `SELECT session_id AS task FROM orchestrator_gate_failures
         WHERE escalated_at >= ? AND escalated_at < ?
       UNION
       SELECT REPLACE(subject, 'task:', '') AS task FROM orchestrator_asks
         WHERE kind = 'gate' AND created_at >= ? AND created_at < ?`
    )
    .all(f, t, f, t);
  return rows.length;
}

export function scopeChangesIn(from: number, to: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM brief_amendments WHERE created_at >= ? AND created_at < ?`
      )
      .get(sqlTime(from), sqlTime(to)) as { n: number }
  ).n;
}

export interface MergedPR {
  number: number;
  title: string;
  mergedAt: number;
  files: string[];
}

const FIX = /^(revert|fix)(\([^)]*\))?!?:|^revert\b/i;
export const ESCAPE_WINDOW_MS = 3 * 24 * 3600 * 1000;

// PRs in `merged` that a later revert or fix PR touched the same files of,
// within three days of the merge.
export function escapesOf(merged: MergedPR[], all: MergedPR[]): MergedPR[] {
  return merged.filter((p) =>
    all.some(
      (q) =>
        q.number !== p.number &&
        q.mergedAt > p.mergedAt &&
        q.mergedAt - p.mergedAt <= ESCAPE_WINDOW_MS &&
        FIX.test(q.title.trim()) &&
        q.files.some((f) => p.files.includes(f))
    )
  );
}

export type Gh = (args: string[], cwd: string) => Promise<string>;
const realGh: Gh = (args, cwd) => runCmd("gh", args, cwd, 60_000);

function repoOf(projectId: string | null): string | null {
  if (!projectId) return null;
  const r = db
    .prepare(
      `SELECT path FROM project_repositories WHERE project_id = ?
       ORDER BY is_primary DESC, sort_order LIMIT 1`
    )
    .get(projectId) as { path: string } | undefined;
  return r?.path ?? null;
}

// Escapes among the tasks merged in [from, to), looking three days past each
// merge. Null when gh couldn't say for any repo: unknown is not zero.
export async function escapesIn(
  tasks: MergedTask[],
  gh: Gh = realGh
): Promise<number | null> {
  const withPR = tasks.filter((t) => t.prNumber !== null);
  if (!withPR.length) return 0;
  const byRepo = new Map<string, MergedTask[]>();
  for (const t of withPR) {
    const repo = repoOf(t.projectId);
    if (!repo) return null;
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), t]);
  }
  let total = 0;
  for (const [repo, ts] of byRepo) {
    try {
      const since = new Date(
        Math.min(
          ...ts.map((t) => Date.parse(t.mergedAt.replace(" ", "T") + "Z"))
        ) - 86_400_000
      )
        .toISOString()
        .slice(0, 10);
      const out = await gh(
        [
          "pr",
          "list",
          "--state",
          "merged",
          "--search",
          `merged:>=${since}`,
          "--json",
          "number,title,mergedAt,files",
          "--limit",
          "300",
        ],
        repo
      );
      const all = (
        JSON.parse(out) as {
          number: number;
          title: string;
          mergedAt: string;
          files?: { path: string }[];
        }[]
      ).map((p) => ({
        number: p.number,
        title: p.title,
        mergedAt: Date.parse(p.mergedAt),
        files: (p.files ?? []).map((f) => f.path),
      }));
      const mine = all.filter((p) => ts.some((t) => t.prNumber === p.number));
      total += escapesOf(mine, all).length;
    } catch {
      return null;
    }
  }
  return total;
}
