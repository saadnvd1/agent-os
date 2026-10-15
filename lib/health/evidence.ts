/**
 * What a watcher is shown: the anomaly, a snapshot of its whole area (so it
 * can name a neighbour no check was written for), and a bounded excerpt of
 * the relevant logs. Built here, deterministically, so the model needs no
 * shell, and everything a third party wrote is fenced as data.
 */

import { db } from "../db";
import { taskOutputTail } from "../chat/task-output";
import { itemsOfKind } from "../chat/store";
import { untrusted } from "../orchestrator/untrusted";
import { recentBoots } from "./boots";
import { recentErrorLines } from "./errors";
import { duration, ciLimit } from "./detectors";
import { MIN, type AnomalyRow, type Area, type HealthFacts } from "./types";

// About 5k tokens.
export const EVIDENCE_CHARS = 18_000;
const TAIL_CHARS = 3_000;

export const PROBES = [
  "server_log",
  "task_output",
  "queue_state",
  "boots",
] as const;
export type Probe = (typeof PROBES)[number];
export const isProbe = (v: unknown): v is Probe =>
  typeof v === "string" && (PROBES as readonly string[]).includes(v);

const ago = (now: number, t: number) => `${duration(Math.max(0, now - t))} ago`;

function detailOf(row: AnomalyRow): Record<string, unknown> {
  try {
    return JSON.parse(row.detail) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function anomalySection(row: AnomalyRow, now: number): string {
  return [
    `Anomaly: ${row.check_id} on ${row.subject}`,
    `Severity ${row.severity}, open ${duration(now - row.opened_at)}, seen ${row.hits} time(s).`,
    `Detector said: ${row.line}`,
  ].join("\n");
}

function schedulerSnapshot(f: HealthFacts): string {
  const lines = ["Machines:"];
  for (const m of f.machines)
    lines.push(
      `- ${m.label}: ${m.level ?? "unknown"}${m.redSince ? ` (red for ${duration(f.now - m.redSince)})` : ""}${m.load1 !== undefined ? `, load ${m.load1} on ${m.cores} cores` : ""}`
    );
  lines.push("Queued tasks:");
  for (const q of f.queue.slice(0, 12))
    lines.push(
      `- ${q.name ?? q.id}: queued ${duration(f.now - q.createdAt)}, ${q.heldBy}`
    );
  if (!f.queue.length) lines.push("- none");
  const running = db
    .prepare(
      `SELECT s.name, s.pause_state, s.plan_only, s.plan_phase, s.task_status
       FROM session_rows s WHERE s.task_status IN ('running', 'moving')
         AND s.archived_at IS NULL AND s.quick_of IS NULL LIMIT 20`
    )
    .all() as {
    name: string;
    pause_state: string | null;
    plan_only: number | null;
    plan_phase: string | null;
    task_status: string;
  }[];
  lines.push("Tasks holding or near a slot:");
  for (const r of running)
    lines.push(
      `- ${r.name}: ${r.task_status}${r.pause_state === "paused" ? ", paused" : ""}${r.plan_only ? `, plan-only (${r.plan_phase ?? "planning"})` : ""}`
    );
  if (!running.length) lines.push("- none");
  return lines.join("\n");
}

function pipelineSnapshot(f: HealthFacts): string {
  const lines = ["Armed PRs:"];
  for (const a of f.armed.slice(0, 10))
    lines.push(
      `- ${a.name}${a.prNumber ? ` #${a.prNumber}` : ""}: armed ${duration(f.now - a.armedAt)}`
    );
  if (!f.armed.length) lines.push("- none");
  lines.push("CI pending:");
  for (const c of f.ci.slice(0, 10))
    lines.push(
      `- PR #${c.prNumber}: pending ${duration(f.now - c.pendingSince)} (usual limit ${duration(ciLimit(c.baseline, 20 * MIN))}, ${c.baseline.length} past runs)`
    );
  if (!f.ci.length) lines.push("- none");
  lines.push("Recent server starts:");
  for (const b of recentBoots(6))
    lines.push(
      `- ${ago(f.now, b.started_at)}${b.head ? ` at ${b.head}` : ""}${b.prev_seen_at ? `; the previous run was last seen ${ago(f.now, b.prev_seen_at)}` : ""}`
    );
  lines.push(
    `Server errors in the last 10 minutes: ${f.errors.recent} (usual ${Math.round(f.errors.baselineMean)}).`
  );
  return lines.join("\n");
}

function tasksSnapshot(f: HealthFacts): string {
  const lines = ["Background jobs running longer than the quiet limit:"];
  for (const b of f.bg.slice(0, 12))
    lines.push(
      `- "${b.description}" in ${b.sessionName}: started ${ago(f.now, b.startedAt)}, ${b.outputAt ? `last output ${ago(f.now, b.outputAt)}` : "no output yet"}`
    );
  if (!f.bg.length) lines.push("- none");
  return lines.join("\n");
}

const SNAPSHOTS: Record<Area, (f: HealthFacts) => string> = {
  scheduler: schedulerSnapshot,
  pipeline: pipelineSnapshot,
  tasks: tasksSnapshot,
};

// The output of the background job an anomaly names.
function taskTail(row: AnomalyRow, chars: number): string | null {
  const d = detailOf(row);
  const sessionId = typeof d.sessionId === "string" ? d.sessionId : null;
  const taskId = typeof d.taskId === "string" ? d.taskId : null;
  if (!sessionId || !taskId) return null;
  const item = itemsOfKind(sessionId, "task").find((t) => t.taskId === taskId);
  const tail = taskOutputTail(taskId, item?.outputFile);
  if (!tail?.text)
    return "(the job has printed nothing, or its output file is gone)";
  return tail.text.slice(-chars);
}

export function evidencePack(row: AnomalyRow, f: HealthFacts): string {
  const parts = [anomalySection(row, f.now), SNAPSHOTS[row.area](f)];
  const tail = row.check_id === "bg-quiet" ? taskTail(row, TAIL_CHARS) : null;
  if (tail) parts.push(untrusted("background job output", tail));
  if (row.check_id === "server-errors" || row.check_id === "restarts")
    parts.push(
      untrusted("server error log", recentErrorLines(15).join("\n") || "(none)")
    );
  return parts.join("\n\n").slice(0, EVIDENCE_CHARS);
}

// What a watcher asked to see next. Always bounded, always fenced.
export function probe(name: Probe, row: AnomalyRow, f: HealthFacts): string {
  const cap = 4_000;
  switch (name) {
    case "server_log":
      return untrusted(
        "server error log",
        recentErrorLines(40).join("\n") || "(no errors recorded)"
      ).slice(0, cap);
    case "task_output":
      return untrusted(
        "background job output",
        taskTail(row, cap) ?? "(this anomaly names no background job)"
      );
    case "queue_state":
      return schedulerSnapshot(f).slice(0, cap);
    case "boots":
      return recentBoots(12)
        .map(
          (b) =>
            `${ago(f.now, b.started_at)} head ${b.head ?? "?"}; previous run last seen ${b.prev_seen_at ? ago(f.now, b.prev_seen_at) : "unknown"}; background jobs then: ${untrusted("boot record", b.prev_bg ?? "[]")}`
        )
        .join("\n")
        .slice(0, cap);
  }
}
