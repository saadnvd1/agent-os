/** The shapes of the start queue: its rows, what clients see, what a request says. */

import type { ModelOverride } from "../models/resolve";
import type { AgentType } from "../providers";
import type { Priority, WaitCode } from "./schedule-types";
import type { StartVia } from "./starter";

export type QueueStatus =
  | "queued"
  | "starting"
  | "started"
  | "failed"
  | "removed";

export interface QueueRow {
  id: string;
  project_id: string;
  prompt: string;
  name: string | null;
  model: string | null;
  // A per-role model map (lib/models), when that's what it was given.
  model_overrides: string | null;
  // The starter's plan decision (1/0, null: not stated), its reason, and the
  // orchestrator session that started it.
  plan: number | null;
  plan_reason: string | null;
  plan_only: number | null;
  started_by: string | null;
  parent_session_id: string | null;
  started_by_device: string | null;
  started_via: string | null;
  view: "chat" | "terminal" | null;
  agent_type: string | null;
  base_branch: string | null;
  host_id: string | null;
  // A task (or queued task) it waits on, by id.
  after_task: string | null;
  // "after any": the tasks running when it was queued, as JSON; the first
  // of them to finish lets it go.
  after_any: string | null;
  // The finish (a task id) this "after any" waiter took; one finish lets one
  // waiter go (a unique index keeps it so).
  after_any_used: string | null;
  priority: Priority;
  // What it needs from a machine, as JSON, when the starter said.
  machine_needs: string | null;
  // The code behind `note`, set by the scheduler.
  wait_code: WaitCode | null;
  // The orchestrator's workspace, when the orchestrator queued it: its
  // start goes through that orchestrator's brakes.
  origin_workspace_id: string | null;
  position: number;
  status: QueueStatus;
  note: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
}

// What the UI and tools see of a queued task. No server imports needed.
export interface QueuedTaskView {
  id: string;
  name: string;
  prompt: string;
  projectId: string;
  projectName: string | null;
  // The workspace whose line it's in, or null for a project without one.
  workspaceId: string | null;
  status: QueueStatus;
  // 1-based place in its workspace's line.
  position: number;
  // What it waits on: a task's name, or "any running task".
  after: string | null;
  // The task it waits on, by id, when it waits on one.
  afterId: string | null;
  note: string | null;
  error: string | null;
  // The orchestrator session that queued it, when one did.
  startedBy: string | null;
  createdAt: string;
  priority: Priority;
  // Why it isn't starting, from the scheduler; null: nothing but its turn.
  wait: WaitCode | null;
  // Its place in the score order within its line, and how many are in it.
  rank: number;
  of: number;
  // Messages held for it until it starts.
  held: number;
}

export const START_ATTEMPTS = 3;

export interface QueueRequest {
  projectId: string;
  prompt: string;
  name?: string;
  model?: ModelOverride;
  plan?: boolean;
  planReason?: string | null;
  planOnly?: boolean;
  startedBy?: string | null;
  parentSessionId?: string | null;
  startedByDevice?: string | null;
  startedVia: StartVia;
  // The waiting plan piece it builds, claimed for its queue id.
  pieceId?: number;
  view?: "chat" | "terminal";
  agent?: AgentType;
  baseBranch?: string;
  hostId?: string;
  // A task's id or name, or "any" for whichever running task finishes first.
  after?: string;
  // Set when the orchestrator starts it.
  originWorkspaceId?: string;
  // Where it sits among the queued: urgent, blocking, normal (the default)
  // or background.
  priority?: Priority;
  // "mac" pins it to a Mac; "any" says it needs nothing in particular.
  machine?: "any" | "mac";
  // Start at once, past the running-task limit, instead of queueing for a
  // slot. Still needs the machine it needs, and an orchestrator's start
  // still passes its brakes.
  now?: boolean;
}

export type StartOutcome = "started" | "held" | "retry" | "failed";

export interface ForcedStart {
  outcome: "started" | "held" | "failed";
  // Why it is held, or what failed; empty when it started.
  text: string;
  // The running-task limit was full when it started.
  wasFull: boolean;
  running: number;
  limit: number | null;
  // It skipped an `after`.
  skippedAfter: boolean;
}

export type QueueRowWithWorkspace = QueueRow & { workspace_id: string | null };
