/**
 * The holds that read the database or this machine, each returning `Hold`s
 * (holds.ts) so every caller that asks "may this start now" gets the same
 * answer and the same words: the orchestrator's Pause and the usage window,
 * `after`, and this machine's load for a start here.
 */

import type { Session } from "../db";
import { getProject } from "../projects";
import { isRemoteHost } from "../hosts";
import { isPaused } from "../orchestrator/pause";
import { brakesEnabled } from "../orchestrator/brakes";
import { readUsage, windowRefusal } from "../orchestrator/usage";
import { localView, machineCapabilities } from "../load/machines";
import { DEFAULT_PRIORITY, type Priority } from "./schedule-types";
import { machineHolds, holdReason, type Hold } from "./holds";
import { heavyNeeds, meetsNeeds, needsOf, type Need } from "./placement";
import { expandHome } from "./session";
import { afterLabel, hasFinished } from "./queue-rows";
import type { QueueRow } from "./queue-types";
import type { PauseBy } from "./schedule-types";

// Why an automatic start has to wait: the orchestrator's Pause, then the
// usage window. A start now by a person isn't held, and a plan-only start
// is held by Pause alone.
export function autoHolds(
  workspaceId: string | null,
  planOnly = false
): Hold[] {
  const out: Hold[] = [];
  if (workspaceId && isPaused(workspaceId))
    out.push({
      code: "orch_paused",
      text: "Waiting: the orchestrator is paused",
    });
  if (planOnly) return out;
  const window = brakesEnabled() ? windowRefusal(readUsage()) : null;
  if (window) out.push({ code: "window", text: `Waiting: ${window}` });
  return out;
}

export const autoHold = (
  workspaceId: string | null,
  planOnly = false
): Hold | null => autoHolds(workspaceId, planOnly)[0] ?? null;

// `after X`: the task it waits on hasn't finished.
export function afterHold(r: QueueRow): Hold | null {
  if (!r.after_task || hasFinished(r.after_task)) return null;
  return {
    code: "after",
    text: `After ${afterLabel({ ...r, after_any: null }) ?? "its task"}`,
  };
}

// What this machine would say to a start of a task with these needs here
// and now: empty means it may start.
export function localHolds(
  ask: { needs: Need[]; priority?: Priority },
  now = Date.now()
): Hold[] {
  return machineHolds(
    {
      heavy: heavyNeeds(ask.needs),
      needsUnmet: !meetsNeeds(ask.needs, machineCapabilities()),
      remote: false,
      priority: ask.priority ?? DEFAULT_PRIORITY,
    },
    localView(now),
    now
  );
}

export const requestNeeds = (
  projectId: string,
  workingDirectory: string,
  prompt: string,
  setting: Need[] | null
): Need[] =>
  setting ??
  needsOf({
    projectId,
    projectPath: expandHome(workingDirectory),
    prompt,
  }).needs;

// Whether the task needs something this machine lacks (a Mac).
export function needsUnmetHere(
  projectId: string,
  prompt: string,
  setting: Need[] | null
): boolean {
  const project = getProject(projectId);
  if (!project || isRemoteHost(project.host_id)) return false;
  return !meetsNeeds(
    requestNeeds(projectId, project.working_directory, prompt, setting),
    machineCapabilities()
  );
}

// Whether this machine's load rules out starting a task for this project now.
export function loadHeldStart(
  projectId: string,
  prompt: string,
  setting: Need[] | null
): boolean {
  const project = getProject(projectId);
  if (!project || isRemoteHost(project.host_id)) return false;
  const head = localHolds({
    needs: requestNeeds(projectId, project.working_directory, prompt, setting),
  })[0];
  return head?.code === "load_red" || head?.code === "heavy";
}

// Why this machine's load rules out starting an agent now, or null. Only a
// red (or still settling) machine holds a resume; amber doesn't.
export function loadHoldFor(s: Session): string | null {
  const project = s.project_id ? getProject(s.project_id) : null;
  if (!project || isRemoteHost(s.host_id ?? project.host_id)) return null;
  const hold = localHolds({ needs: [] })[0];
  return hold?.code === "load_red" ? holdReason(hold) : null;
}

// Why a resume this actor asked for must wait: this machine's load, and for
// the orchestrator also what holds its own starts (it is paused, or the
// usage window). A person's own resume skips the second.
export function resumeHoldFor(s: Session, actor: PauseBy): string | null {
  const load = loadHoldFor(s);
  if (load) return load;
  if (actor !== "orchestrator") return null;
  const ws = s.project_id ? getProject(s.project_id)?.workspace_id : null;
  const hold = autoHold(ws ?? null);
  return hold ? holdReason(hold) : null;
}
