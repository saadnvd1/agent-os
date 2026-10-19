/**
 * The one loop that brings this machine's mirrors in line with what their
 * machines say. Each tick reads every machine's task list once and applies it
 * to each mirror: finished and moved, a plan written, a plan note to tell the
 * orchestrator about, an approved plan coming home. Nothing else polls a
 * machine's tasks to write a mirror.
 */

import { db, type Session } from "../../db";
import { isRemoteHost } from "../../hosts";
import { hostLink, cleanRemoteText } from "../../hosts/remote-api";
import { sessionWorkspace } from "../../models/resolve";
import { queueEvent } from "../../orchestrator/events";
import { orchestratorOf } from "../starter";
import type { TaskStatus } from "../state";
import type { TaskView } from "../index";
import * as client from "./client";
import {
  finishArrival,
  fire,
  handingOff,
  handoffHome,
  planWritten,
} from "./plan";
import { setMirrorStatus } from "./start";
import { setPlan } from "../../db/session-parts";

const FINISHED: Record<string, TaskStatus> = {
  merged: "merged",
  dropped: "dropped",
  done: "done",
};

const getSession = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as
    Session | undefined;

// The plan-written line a held task stored on its machine (plan-step.ts),
// once per distinct plan: the mirror keeps the last one it told about.
function announcePlanNote(s: Session, view: TaskView): void {
  const workspaceId = sessionWorkspace(s);
  if (!workspaceId || !orchestratorOf(s.started_by)) return;
  const note =
    typeof view.planNote === "string"
      ? cleanRemoteText(view.planNote).slice(0, 2000)
      : "";
  if (!note || note === s.plan_note) return;
  setPlan(db, s.id, { plan_note: note });
  queueEvent(workspaceId, `plan-done:${s.id}`, s.id, note);
}

async function applyView(
  s: Session,
  view: TaskView | undefined,
  gone: Set<string>
): Promise<void> {
  if (!view) {
    if (gone.has(s.id)) setMirrorStatus(s.id, "moved");
    return;
  }
  if (FINISHED[view.state]) {
    setMirrorStatus(s.id, FINISHED[view.state]);
    return;
  }
  if (!s.plan_waits_for_caller) return announcePlanNote(s, view);
  if (s.plan_phase === "planning") await planWritten(s, view);
  else if (s.plan_phase === "handoff") fire(s.id, () => handoffHome(s.id));
}

/** Every task this machine mirrors from a linked machine, that machine's word applied. */
export async function syncMirrors(): Promise<void> {
  const rows = (
    db
      .prepare(
        `SELECT * FROM session_rows
         WHERE task_prompt IS NOT NULL AND task_status = 'running'
           AND archived_at IS NULL AND peer_mirror IS NOT 1
           AND host_id IS NOT NULL`
      )
      .all() as Session[]
  ).filter((s) => isRemoteHost(s.host_id));
  const byHost = new Map<string, Session[]>();
  for (const s of rows)
    byHost.set(s.host_id, [...(byHost.get(s.host_id) ?? []), s]);
  for (const [hostId, mirrors] of byHost) {
    const link = hostLink(hostId);
    if (!link) continue;
    let listing: Awaited<ReturnType<typeof client.list>>;
    try {
      listing = await client.list(link);
    } catch {
      continue;
    }
    const live = new Map(
      (Array.isArray(listing.tasks) ? listing.tasks : []).map((t) => [t?.id, t])
    );
    const gone = new Set((listing.moved ?? []).map((m) => m.id));
    for (const s of mirrors) {
      try {
        await applyView(s, live.get(s.id), gone);
      } catch (e) {
        console.error(`Mirror of ${s.id} on ${hostId} failed:`, e);
      }
    }
  }
  // A task that arrived but never began implementing (a restart between).
  const arrived = db
    .prepare(
      `SELECT id, plan_handoff_message FROM session_rows
       WHERE plan_phase = 'awaiting' AND plan_handoff_message IS NOT NULL
         AND task_status = 'running' AND archived_at IS NULL AND peer_mirror IS NOT 1`
    )
    .all() as { id: string; plan_handoff_message: string }[];
  for (const a of arrived) {
    if (isRemoteHost(getSession(a.id)?.host_id)) continue;
    fire(a.id, async () => {
      handingOff.add(a.id);
      try {
        await finishArrival(a.id, a.plan_handoff_message);
      } finally {
        handingOff.delete(a.id);
      }
    });
  }
}
