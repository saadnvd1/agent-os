/**
 * One snapshot of what the detectors need, read cheaply: database rows, the
 * load monitor's last sample, a file's mtime. Nothing here calls gh, a
 * model or a process listing, because it runs every minute.
 */

import { db } from "../db";
import { itemsOfKind } from "../chat/store";
import { taskOutputTail } from "../chat/task-output";
import { runningWorkers } from "../chat/worker/client";
import { localFacts } from "../load/machines";
import { listQueue } from "../tasks/queue";
import { pendingCi } from "./ci";
import { bootsSince } from "./boots";
import { errorRate } from "./errors";
import type { HealthConfig } from "./config";
import {
  MIN,
  type ArmedFact,
  type BgFact,
  type HealthFacts,
  type MachineFact,
  type QueueFact,
} from "./types";

const sqliteMs = (v: string | null) =>
  v ? Date.parse(v.includes("T") ? v : `${v.replace(" ", "T")}Z`) || 0 : 0;

// When each machine turned red, kept while it stays red. A restart forgets
// it, which only delays a trip by the threshold.
const redSince = new Map<string, number>();

export function trackRed(
  id: string,
  level: MachineFact["level"],
  now: number
): number | null {
  if (level !== "red") {
    redSince.delete(id);
    return null;
  }
  if (!redSince.has(id)) redSince.set(id, now);
  return redSince.get(id) ?? null;
}

export const resetRedTracking = () => redSince.clear();

function machines(now: number): MachineFact[] {
  const l = localFacts();
  return [
    {
      id: "local",
      label: "This machine",
      level: l.level,
      redSince: trackRed("local", l.level, now),
      load1: l.load1,
      cores: l.cores,
    },
  ];
}

function queue(): QueueFact[] {
  return listQueue()
    .filter((q) => q.status === "queued")
    .map((q) => ({
      id: q.id,
      name: q.name,
      projectId: q.projectId,
      workspaceId: q.workspaceId,
      createdAt: sqliteMs(q.createdAt),
      heldBy:
        q.note ??
        (q.after ? `waiting for ${q.after}` : "waiting for a free slot"),
    }));
}

// Background jobs still running in a chat whose agent is alive, that have
// been going long enough to be worth a look at their output.
function backgroundJobs(now: number, c: HealthConfig): BgFact[] {
  const live = new Set(runningWorkers());
  if (!live.size) return [];
  const sessions = db
    .prepare(
      `SELECT s.id, s.name, p.workspace_id FROM sessions s
       LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.archived_at IS NULL AND s.view = 'chat'`
    )
    .all() as { id: string; name: string; workspace_id: string | null }[];
  const out: BgFact[] = [];
  for (const s of sessions) {
    if (!live.has(s.id)) continue;
    for (const t of itemsOfKind(s.id, "task")) {
      if (t.status !== "running" || t.ambient) continue;
      if (now - t.createdAt < c.bgQuietMinutes * MIN) continue;
      const tail = taskOutputTail(t.taskId, t.outputFile);
      out.push({
        sessionId: s.id,
        sessionName: s.name,
        workspaceId: s.workspace_id,
        taskId: t.taskId,
        description: t.description,
        startedAt: t.createdAt,
        outputAt: tail?.updatedAt ?? null,
      });
    }
  }
  return out;
}

// Every running background job, for the heartbeat a restart reads back.
export function liveBackgroundJobs(): string[] {
  const live = new Set(runningWorkers());
  const out: string[] = [];
  for (const id of live) {
    for (const t of itemsOfKind(id, "task"))
      if (t.status === "running" && !t.ambient) out.push(t.description);
  }
  return out;
}

function armed(): ArmedFact[] {
  return (
    db
      .prepare(
        `SELECT s.id, s.name, s.merge_armed_at, s.pr_number, p.workspace_id
         FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
         WHERE s.merge_armed_at IS NOT NULL AND s.archived_at IS NULL
           AND COALESCE(s.task_status, 'running') = 'running'`
      )
      .all() as {
      id: string;
      name: string;
      merge_armed_at: string;
      pr_number: number | null;
      workspace_id: string | null;
    }[]
  ).map((r) => ({
    sessionId: r.id,
    name: r.name,
    workspaceId: r.workspace_id,
    armedAt: sqliteMs(r.merge_armed_at),
    prNumber: r.pr_number,
  }));
}

export function gatherFacts(now: number, c: HealthConfig): HealthFacts {
  return {
    now,
    machines: machines(now),
    queue: queue(),
    bg: backgroundJobs(now, c),
    armed: armed(),
    ci: pendingCi(now),
    boots: bootsSince(now - c.restartsWindowMinutes * MIN).map(
      (b) => b.started_at
    ),
    errors: errorRate(now),
  };
}
