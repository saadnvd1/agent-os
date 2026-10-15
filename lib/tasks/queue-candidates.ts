/**
 * Building the candidates a look at the line scores: a fresh or retried start
 * from a queue row, and a paused task that came due to resume. Each carries
 * the holds that need the database (`after`, Pause, the usage window); the
 * machine's holds are applied when the line is planned.
 */

import { getProject } from "../projects";
import { isRemoteHost } from "../hosts";
import { machineCapabilities } from "../load/machines";
import {
  claimResume,
  resumeHoldFor,
  setPauseNote,
  type DueResume,
} from "./pause";
import {
  heavyNeeds,
  meetsNeeds,
  needsOf,
  parseNeeds,
  type Need,
} from "./placement";
import { DEFAULT_PRIORITY, isPriority } from "./schedule-types";
import type { Candidate, Group } from "./schedule";
import { expandHome } from "./session";
import { afterHold, autoHold } from "./hold-checks";
import {
  groupFor,
  groupKey,
  sessionOf,
  sqliteMs,
  stillWorking,
  workspaceOf,
} from "./queue-rows";
import type { QueueRowWithWorkspace } from "./queue-types";

export function candidateOf(
  r: QueueRowWithWorkspace,
  used: string[]
): { c: Candidate; needs: Need[] } {
  const project = getProject(r.project_id);
  const hostId = r.host_id ?? project?.host_id;
  const remote = isRemoteHost(hostId);
  const needs = remote
    ? []
    : (parseNeeds(r.machine_needs) ??
      (project
        ? needsOf({
            projectId: project.id,
            projectPath: expandHome(project.working_directory),
            prompt: r.prompt,
          }).needs
        : []));
  let any: Candidate["any"] = null;
  if (r.after_any) {
    const ids = JSON.parse(r.after_any) as string[];
    any = {
      ids,
      finished: ids.filter((id) => !stillWorking(id)),
      used: used.filter((id) => id !== r.after_any_used),
      released: !!r.after_any_used,
      label:
        ids
          .filter(stillWorking)
          .map((id) => sessionOf(id)?.name ?? id.slice(0, 8))
          .join(", ") || "its set",
    };
  }
  return {
    needs,
    c: {
      id: r.id,
      kind: "start",
      group: groupKey(r.workspace_id, r.project_id),
      priority: isPriority(r.priority) ? r.priority : DEFAULT_PRIORITY,
      position: r.position,
      waitingSinceMs: sqliteMs(r.created_at),
      heavy: heavyNeeds(needs),
      needsUnmet: !remote && !meetsNeeds(needs, machineCapabilities()),
      remote,
      planOnly: !!r.plan_only,
      before: afterHold(r),
      auto: autoHold(r.workspace_id, !!r.plan_only),
      any,
    },
  };
}

// A paused task that came due, as a candidate to score against new arrivals.
export function resumeCandidate(d: DueResume): Candidate {
  const workspaceId = workspaceOf(d.projectId);
  return {
    id: `resume:${d.sessionId}`,
    kind: "resume",
    group: groupKey(workspaceId, d.projectId),
    priority: d.priority,
    position: -1_000_000 + d.pauseId,
    waitingSinceMs: d.dueAtMs,
    heavy: false,
    needsUnmet: false,
    remote: false,
    before: null,
    // A person's timed resume goes ahead of an orchestrator Pause.
    auto: d.byKind === "person" ? null : autoHold(workspaceId),
    any: null,
  };
}

// A deliberate resume starts past the slot limit; only a red machine holds
// it, and the task says so.
export async function forceDueResumes(due: DueResume[]): Promise<void> {
  for (const d of due.filter((x) => x.resumeBy)) {
    const s = sessionOf(d.sessionId);
    const why = s ? resumeHoldFor(s, d.resumeBy!) : null;
    if (why) setPauseNote(d.sessionId, `held: ${why}`);
    else await claimResume(d.sessionId, { reason: d.resumeBy!, force: true });
  }
}

// Each line's running count and limit, for the lines the candidates are in.
export function buildGroups(
  candidates: Candidate[],
  rows: QueueRowWithWorkspace[],
  resumes: DueResume[]
): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const c of candidates) {
    if (groups.has(c.group)) continue;
    const r = rows.find(
      (x) => groupKey(x.workspace_id, x.project_id) === c.group
    );
    const projectId =
      r?.project_id ??
      resumes.find((d) => `resume:${d.sessionId}` === c.id)!.projectId;
    const workspaceId = r?.workspace_id ?? workspaceOf(projectId);
    groups.set(
      c.group,
      groupFor(
        workspaceId,
        projectId,
        rows.filter(
          (x) =>
            x.status === "starting" &&
            groupKey(x.workspace_id, x.project_id) === c.group
        ).length
      )
    );
  }
  return groups;
}
