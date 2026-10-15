/**
 * Starting one queued row: the claim, the brakes, the task's creation, and
 * what is recorded and announced when it started or failed.
 */

import type { ModelOverride } from "../models/resolve";
import type { AgentType } from "../providers";
import { db, type Session } from "../db";
import { getProject } from "../projects";
import { isRemoteHost } from "../hosts";
import { BrakeRefused, braked, recordStart } from "../orchestrator/brakes";
import { queueEvent } from "../orchestrator/events";
import { createTask } from "./index";
import {
  markQueuedHeldDelivered,
  queuedHeldMessages,
  queuedMessagesSection,
} from "./queue-held";
import { DEFAULT_PRIORITY } from "./schedule-types";
import { LOCAL, recordAutoStart } from "../load/machines";
import { autoHold } from "./hold-checks";
import type { Placement } from "./placement";
import type { StartVia } from "./starter";
import { limitOf, patch, runningIn, sessionOf, startingIn } from "./queue-rows";
import {
  START_ATTEMPTS,
  type QueueRow,
  type StartOutcome,
} from "./queue-types";
import { setPlacement, setTask } from "../db/session-parts";

// Tells the orchestrator that queued it that it started.
export function announce(
  r: Pick<QueueRow, "id" | "origin_workspace_id">,
  session: Pick<Session, "name" | "branch_name">,
  placed?: { text: string } | null
): void {
  if (!r.origin_workspace_id) return;
  queueEvent(
    r.origin_workspace_id,
    `queued-start:${r.id}`,
    r.id,
    placed
      ? `Queued task "${session.name}" (id ${r.id.slice(0, 8)}) ${placed.text}.`
      : `Queued task "${session.name}" (id ${r.id.slice(0, 8)}) started on ${session.branch_name ?? "its branch"}.`
  );
}

export interface StartOpts {
  force?: boolean;
  // The finish an "after any" start takes (null: none left to take).
  consume?: string | null;
  // Start on this linked machine instead of the project's.
  placement?: Placement | null;
  heavy?: boolean;
  // Pass this workspace's brakes even for a row no orchestrator queued.
  brakeAs?: string;
}

export async function startRow(
  r: QueueRow,
  opts: StartOpts = {}
): Promise<StartOutcome> {
  const project = getProject(r.project_id);
  const workspaceId = project?.workspace_id ?? null;
  const origin = r.origin_workspace_id;
  // The orchestrator starts only in its own workspace's projects on this
  // machine; the project may have moved since it was queued.
  if (
    origin &&
    (!project ||
      workspaceId !== origin ||
      isRemoteHost(r.host_id ?? project.host_id))
  ) {
    patch(r.id, {
      status: "failed",
      error:
        "Not started: its project left the orchestrator's workspace or this machine",
    });
    return "failed";
  }
  if (!opts.force) {
    const held = autoHold(workspaceId, !!r.plan_only);
    if (held) {
      if (r.note !== held.text)
        patch(r.id, { note: held.text, wait_code: held.code });
      return "held";
    }
    // A start that came in during this tick's earlier starts may have taken
    // the slot it planned on. The check and the claim are both synchronous.
    const limit = limitOf(workspaceId);
    if (
      workspaceId &&
      limit !== null &&
      !r.plan_only &&
      runningIn({ workspaceId, projectId: r.project_id }, true).length +
        startingIn(workspaceId) >=
        limit
    )
      return "held";
  }
  let claimed = 0;
  try {
    claimed = db
      .prepare(
        `UPDATE task_queue SET status = 'starting', note = NULL, wait_code = NULL,
           after_any_used = COALESCE(after_any_used, @used)
         WHERE id = @id AND status = 'queued'`
      )
      .run({ id: r.id, used: opts.consume ?? null }).changes;
  } catch (error) {
    // Another waiter took that finish between the plan and the claim.
    if (String(error).includes("UNIQUE")) return "held";
    throw error;
  }
  if (!claimed) return "held";
  const placed = opts.placement ?? null;
  if (!opts.force && !r.plan_only)
    recordAutoStart(placed?.hostId ?? LOCAL, !!opts.heavy, Date.now());
  // A linked machine's start never sees this machine's held messages: they
  // go with the brief it is sent.
  const remote = isRemoteHost(placed?.hostId ?? r.host_id ?? project?.host_id);
  const remoteHeld = remote ? queuedHeldMessages(r.id) : [];
  const task = {
    id: r.id,
    projectId: r.project_id,
    prompt: r.prompt + queuedMessagesSection(remoteHeld),
    name: r.name ?? undefined,
    model: r.model_overrides
      ? (JSON.parse(r.model_overrides) as ModelOverride)
      : (r.model ?? undefined),
    plan: r.plan == null ? undefined : !!r.plan,
    planReason: r.plan_reason,
    planOnly: !!r.plan_only,
    startedBy: r.started_by,
    parentSessionId: r.parent_session_id,
    startedByDevice: r.started_by_device,
    startedVia: (r.started_via ??
      (r.started_by ? "session" : "person")) as StartVia,
    view: r.view ?? undefined,
    agent: (r.agent_type as AgentType | null) ?? undefined,
    baseBranch: r.base_branch ?? undefined,
    hostId: placed?.hostId ?? r.host_id ?? undefined,
    reclaim: true,
  };
  const placedText = placed
    ? `started on ${placed.name} · ${placed.why}`
    : null;
  try {
    // The orchestrator's queued starts pass its brakes when they start,
    // a person's "start now" included: it skips only the limit and `after`.
    const brakeWs = origin ?? opts.brakeAs;
    const session = brakeWs
      ? await braked(
          brakeWs,
          "task",
          () => createTask(task),
          (s) => s.id,
          { spendApproval: false }
        )
      : await createTask(task);
    if (remoteHeld.length) markQueuedHeldDelivered(r.id);
    patch(r.id, {
      status: "started",
      started_at: new Date().toISOString(),
      error: null,
      note: null,
    });
    stampStarted(r, placed);
    announce(r, session, placedText ? { text: placedText } : null);
    return "started";
  } catch (error) {
    if (error instanceof BrakeRefused) {
      patch(r.id, { status: "queued", note: `Waiting: ${error.reason}` });
      if (opts.force) throw error;
      return "held";
    }
    const message = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 300);
    // Its row exists: the task is there, only its launch failed.
    // The brakes never got to count it: count and announce it here.
    const session = sessionOf(r.id);
    if (session?.task_status) {
      patch(r.id, { status: "started", started_at: new Date().toISOString() });
      if (origin) recordStart(origin, "task", r.id);
      announce(r, session);
      return "started";
    }
    const attempts = r.attempts + 1;
    const retry = attempts < START_ATTEMPTS && !opts.force;
    patch(r.id, {
      status: retry ? "queued" : "failed",
      attempts,
      error: retry
        ? `Start failed (try ${attempts} of ${START_ATTEMPTS}), trying again: ${message}`
        : `Could not start: ${message}`,
    });
    return retry ? "retry" : "failed";
  }
}

// Marks the task a queue row became: its priority, and where it was placed.
function stampStarted(r: QueueRow, placed: Placement | null): void {
  const note = placed ? `Started on ${placed.name} · ${placed.why}` : null;
  const priority =
    r.priority && r.priority !== DEFAULT_PRIORITY ? r.priority : null;
  if (!note && !priority) return;
  db.transaction(() => {
    setTask(db, r.id, { priority: priority ?? undefined });
    setPlacement(db, r.id, { placed_note: note ?? undefined });
  })();
}
