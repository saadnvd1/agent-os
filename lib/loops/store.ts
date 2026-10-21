import { randomUUID } from "crypto";
import { db } from "../db";
import type {
  Analysis,
  Criterion,
  CriterionDraft,
  CriterionStatus,
  CycleRow,
  CycleState,
  CycleTrigger,
  Evidence,
  EvidenceSummary,
  Limits,
  LoopRow,
  Score,
  Sender,
  StopReason,
} from "./types";

const json = <T>(v: unknown): T | null => {
  if (typeof v !== "string") return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const loopOf = (r: any): LoopRow => ({
  id: r.id,
  sessionId: r.session_id,
  workspaceId: r.workspace_id,
  state: r.state,
  stopReason: r.stop_reason,
  stopDetail: r.stop_detail,
  goal: r.goal,
  maxCycles: r.max_cycles,
  maxCostUsd: r.max_cost_usd,
  maxMinutes: r.max_minutes,
  graceSeconds: r.grace_seconds,
  stallCycles: r.stall_cycles,
  repeatCycles: r.repeat_cycles,
  costBaseUsd: r.cost_base_usd,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  lastCycleAt: r.last_cycle_at,
  runNow: !!r.run_now,
});

const criterionOf = (r: any): Criterion => ({
  id: r.id,
  loopId: r.loop_id,
  position: r.position,
  text: r.text,
  source: r.source,
  evidenceKind: r.evidence_kind,
  status: r.status,
  evidence: json<Evidence>(r.evidence),
  verified: !!r.verified,
  metCycle: r.met_cycle,
  waivedBy: r.waived_by,
});

const cycleOf = (r: any): CycleRow => ({
  id: r.id,
  loopId: r.loop_id,
  n: r.n,
  trigger: r.trigger,
  state: r.state,
  snapshotSha: r.snapshot_sha,
  tree: r.tree,
  changed: !!r.changed,
  evidence: json<EvidenceSummary>(r.evidence),
  logPath: r.log_path,
  analysis: json<Analysis>(r.analysis),
  signature: r.signature,
  score: json<Score>(r.score),
  instruction: r.instruction,
  instructionSent: r.instruction_sent,
  sender: r.sender,
  delivery: r.delivery,
  sendAt: r.send_at,
  input: r.input,
  costUsd: r.cost_usd,
  error: r.error,
  startedAt: r.started_at,
  endedAt: r.ended_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export function insertLoop(input: {
  sessionId: string;
  workspaceId: string | null;
  goal: string;
  limits: Limits;
  costBaseUsd: number;
  now: number;
}): LoopRow {
  const id = randomUUID();
  const l = input.limits;
  db.prepare(
    `INSERT INTO task_loops (id, session_id, workspace_id, goal, max_cycles,
       max_cost_usd, max_minutes, grace_seconds, stall_cycles, repeat_cycles,
       cost_base_usd, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.sessionId,
    input.workspaceId,
    input.goal,
    l.maxCycles,
    l.maxCostUsd,
    l.maxMinutes,
    l.graceSeconds,
    l.stallCycles,
    l.repeatCycles,
    input.costBaseUsd,
    input.now
  );
  return getLoop(id)!;
}

export function getLoop(id: string): LoopRow | null {
  const r = db.prepare(`SELECT * FROM task_loops WHERE id = ?`).get(id);
  return r ? loopOf(r) : null;
}

export function liveLoopFor(sessionId: string): LoopRow | null {
  const r = db
    .prepare(
      `SELECT * FROM task_loops WHERE session_id = ? AND state = 'running'`
    )
    .get(sessionId);
  return r ? loopOf(r) : null;
}

// The running loop, else the one that stopped last.
export function latestLoopFor(sessionId: string): LoopRow | null {
  const r = db
    .prepare(
      `SELECT * FROM task_loops WHERE session_id = ?
       ORDER BY (state = 'running') DESC, started_at DESC LIMIT 1`
    )
    .get(sessionId);
  return r ? loopOf(r) : null;
}

export function runningLoops(workspaceId?: string): LoopRow[] {
  const rows = workspaceId
    ? db
        .prepare(
          `SELECT * FROM task_loops WHERE state = 'running' AND workspace_id = ?`
        )
        .all(workspaceId)
    : db.prepare(`SELECT * FROM task_loops WHERE state = 'running'`).all();
  return rows.map(loopOf);
}

export function stopLoopRow(
  id: string,
  reason: StopReason,
  detail: string | null,
  now: number
): boolean {
  return (
    db
      .prepare(
        `UPDATE task_loops SET state = 'stopped', stop_reason = ?, stop_detail = ?, ended_at = ?
         WHERE id = ? AND state = 'running'`
      )
      .run(reason, detail, now, id).changes > 0
  );
}

export function setLimits(id: string, l: Partial<Limits>): void {
  const map: Record<keyof Limits, string> = {
    maxCycles: "max_cycles",
    maxCostUsd: "max_cost_usd",
    maxMinutes: "max_minutes",
    graceSeconds: "grace_seconds",
    stallCycles: "stall_cycles",
    repeatCycles: "repeat_cycles",
  };
  for (const [k, v] of Object.entries(l))
    if (v !== undefined && k in map)
      db.prepare(
        `UPDATE task_loops SET ${map[k as keyof Limits]} = ? WHERE id = ?`
      ).run(v, id);
}

export function setRunNow(id: string, on: boolean): void {
  db.prepare(`UPDATE task_loops SET run_now = ? WHERE id = ?`).run(
    on ? 1 : 0,
    id
  );
}

export function touchLoop(id: string, now: number): void {
  db.prepare(`UPDATE task_loops SET last_cycle_at = ? WHERE id = ?`).run(
    now,
    id
  );
}

// Resumed from a limit stop: the same loop runs again.
export function reopenLoop(id: string): boolean {
  return (
    db
      .prepare(
        `UPDATE task_loops SET state = 'running', stop_reason = NULL, stop_detail = NULL, ended_at = NULL
         WHERE id = ? AND state = 'stopped'`
      )
      .run(id).changes > 0
  );
}

/* Criteria */

export function criteriaOf(loopId: string): Criterion[] {
  return db
    .prepare(
      `SELECT * FROM task_loop_criteria WHERE loop_id = ? AND removed = 0 ORDER BY position, id`
    )
    .all(loopId)
    .map(criterionOf);
}

export function addCriteria(
  loopId: string,
  drafts: CriterionDraft[]
): Criterion[] {
  const start =
    (
      db
        .prepare(
          `SELECT COALESCE(MAX(position), -1) AS p FROM task_loop_criteria WHERE loop_id = ?`
        )
        .get(loopId) as { p: number }
    ).p + 1;
  const insert = db.prepare(
    `INSERT INTO task_loop_criteria (loop_id, position, text, source, evidence_kind) VALUES (?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    drafts.forEach((d, i) =>
      insert.run(
        loopId,
        start + i,
        d.text,
        d.source ?? "user",
        d.evidenceKind ?? null
      )
    );
  })();
  return criteriaOf(loopId);
}

export function editCriterion(
  id: number,
  loopId: string,
  text: string
): boolean {
  return (
    db
      .prepare(
        `UPDATE task_loop_criteria SET text = ?, status = 'open', evidence = NULL, verified = 1, met_cycle = NULL, waived_by = NULL
         WHERE id = ? AND loop_id = ? AND removed = 0`
      )
      .run(text, id, loopId).changes > 0
  );
}

export function removeCriterion(id: number, loopId: string): boolean {
  return (
    db
      .prepare(
        `UPDATE task_loop_criteria SET removed = 1 WHERE id = ? AND loop_id = ?`
      )
      .run(id, loopId).changes > 0
  );
}

export function waiveCriterion(
  id: number,
  loopId: string,
  by: string
): boolean {
  return (
    db
      .prepare(
        `UPDATE task_loop_criteria SET status = 'waived', waived_by = ?, verified = 1
         WHERE id = ? AND loop_id = ? AND removed = 0`
      )
      .run(by, id, loopId).changes > 0
  );
}

export function markCriterion(
  id: number,
  status: CriterionStatus,
  evidence: Evidence | null,
  verified: boolean,
  cycleN: number
): void {
  db.prepare(
    `UPDATE task_loop_criteria SET status = ?, evidence = ?, verified = ?,
       met_cycle = CASE WHEN ? = 'met' THEN ? ELSE NULL END
     WHERE id = ? AND status != 'waived'`
  ).run(
    status,
    evidence ? JSON.stringify(evidence) : null,
    verified ? 1 : 0,
    status,
    cycleN,
    id
  );
}

/* Cycles */

export function cyclesOf(
  loopId: string,
  opts: { before?: number; limit?: number } = {}
): CycleRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM task_loop_cycles WHERE loop_id = ? AND n < ? ORDER BY n DESC LIMIT ?`
    )
    .all(loopId, opts.before ?? Number.MAX_SAFE_INTEGER, opts.limit ?? 20);
  return rows.map(cycleOf);
}

export function getCycle(loopId: string, n: number): CycleRow | null {
  const r = db
    .prepare(`SELECT * FROM task_loop_cycles WHERE loop_id = ? AND n = ?`)
    .get(loopId, n);
  return r ? cycleOf(r) : null;
}

export function lastCycle(loopId: string): CycleRow | null {
  const r = db
    .prepare(
      `SELECT * FROM task_loop_cycles WHERE loop_id = ? ORDER BY n DESC LIMIT 1`
    )
    .get(loopId);
  return r ? cycleOf(r) : null;
}

export function cycleCount(loopId: string): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS c FROM task_loop_cycles WHERE loop_id = ?`)
      .get(loopId) as {
      c: number;
    }
  ).c;
}

// Claims the next cycle number; the unique index makes two claims one.
export function claimCycle(
  loopId: string,
  trigger: CycleTrigger,
  now: number
): CycleRow | null {
  const n = (lastCycle(loopId)?.n ?? 0) + 1;
  try {
    db.prepare(
      `INSERT INTO task_loop_cycles (loop_id, n, trigger, started_at) VALUES (?, ?, ?, ?)`
    ).run(loopId, n, trigger, now);
  } catch {
    return null;
  }
  return getCycle(loopId, n);
}

const CYCLE_COLUMNS = {
  state: "state",
  snapshotSha: "snapshot_sha",
  tree: "tree",
  changed: "changed",
  evidence: "evidence",
  logPath: "log_path",
  analysis: "analysis",
  signature: "signature",
  score: "score",
  instruction: "instruction",
  instructionSent: "instruction_sent",
  sender: "sender",
  delivery: "delivery",
  sendAt: "send_at",
  input: "input",
  costUsd: "cost_usd",
  error: "error",
  endedAt: "ended_at",
} as const;

export type CyclePatch = Partial<{
  state: CycleState;
  snapshotSha: string | null;
  tree: string | null;
  changed: boolean;
  evidence: EvidenceSummary | null;
  logPath: string | null;
  analysis: Analysis | null;
  signature: string | null;
  score: Score | null;
  instruction: string | null;
  instructionSent: string | null;
  sender: Sender | null;
  delivery: string | null;
  sendAt: number | null;
  input: string | null;
  costUsd: number;
  error: string | null;
  endedAt: number | null;
}>;

export function patchCycle(loopId: string, n: number, patch: CyclePatch): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = CYCLE_COLUMNS[k as keyof typeof CYCLE_COLUMNS];
    if (!col || v === undefined) continue;
    sets.push(`${col} = ?`);
    values.push(
      v !== null && typeof v === "object"
        ? JSON.stringify(v)
        : typeof v === "boolean"
          ? v
            ? 1
            : 0
          : v
    );
  }
  if (!sets.length) return;
  db.prepare(
    `UPDATE task_loop_cycles SET ${sets.join(", ")} WHERE loop_id = ? AND n = ?`
  ).run(...values, loopId, n);
}

// Moves a cycle from one state to another only if it is still in the first,
// so two presses (or a press and the timer) act once.
export function moveCycle(
  loopId: string,
  n: number,
  from: CycleState[],
  patch: CyclePatch & { state: CycleState }
): boolean {
  const marks = from.map(() => "?").join(",");
  const cur = db
    .prepare(`SELECT state FROM task_loop_cycles WHERE loop_id = ? AND n = ?`)
    .get(loopId, n) as { state: CycleState } | undefined;
  if (!cur || !from.includes(cur.state)) return false;
  const claimed = db
    .prepare(
      `UPDATE task_loop_cycles SET state = ? WHERE loop_id = ? AND n = ? AND state IN (${marks})`
    )
    .run(patch.state, loopId, n, ...from).changes;
  if (!claimed) return false;
  patchCycle(loopId, n, patch);
  return true;
}

// Chat spend of a session since a time, from the per-turn ledger.
export function chatSpendSince(sessionId: string, since: number): number {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS c FROM chat_turns WHERE session_id = ? AND at >= ?`
    )
    .get(sessionId, since) as { c: number };
  return r.c;
}

export function analystSpend(loopId: string): number {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS c FROM task_loop_cycles WHERE loop_id = ?`
    )
    .get(loopId) as { c: number };
  return r.c;
}
