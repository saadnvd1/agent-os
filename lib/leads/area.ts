// Whether a lead's start or stop falls inside its area. The area is data
// (lead_areas): the projects and boards the lead owns. A target that can't
// be found, or sits in no project, is refused: the check fails closed.

import type { Project } from "@/lib/db/types";
import { getProject } from "../projects";
import { findRecipe } from "../recipes/store";
import { findWorkspaceSession } from "../orchestrator/read";
import { workspaceProject, workspaceTask } from "../orchestrator/targets";
import { leadAreas } from "./charters";
import { leadTitle } from "./home";
import type { LeadKind } from "./types";

type Args = Record<string, unknown>;
type Found = Project | null | undefined;
const str = (v: unknown) => (typeof v === "string" ? v : "");

// Each area-checked tool, and the project its call acts on.
const TARGET: Record<string, (w: string, a: Args) => Found> = {
  start_task: (w, a) => workspaceProject(w, str(a.project)),
  start_session: (w, a) => workspaceProject(w, str(a.project)),
  stack: (w, a) => workspaceProject(w, str(a.target), { boards: true }),
  run_recipe: (w, a) => getProject(findRecipe(w, str(a.name)).project_id),
  ...Object.fromEntries(
    [
      "drop",
      "pause_task",
      "resume_task",
      "set_priority",
      "approve_plan",
      "plan_pieces",
      "set_task_model",
    ].map((t) => [
      t,
      (w: string, a: Args) =>
        getProject(workspaceTask(w, str(a.task)).project_id ?? ""),
    ])
  ),
  ...Object.fromEntries(
    ["stop", "archive", "resurrect", "set_group"].map((t) => [
      t,
      (w: string, a: Args) =>
        getProject(findWorkspaceSession(w, str(a.session)).project_id ?? ""),
    ])
  ),
};

export const AREA_CHECKED = Object.keys(TARGET);

export function areaRefusal(
  workspaceId: string,
  kind: LeadKind,
  tool: string,
  args: unknown
): string | null {
  const target = TARGET[tool];
  if (!target) return null;
  let project: Found;
  try {
    project = target(workspaceId, (args ?? {}) as Args);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  // Not one of the workspace's projects (a session in none): not its area.
  if (!project)
    return `That isn't in a project of your area, so ${tool} is refused. Hand it to the Tech lead with message_lead.`;
  const areas = leadAreas(workspaceId, kind);
  const owns = areas.some(
    (a) =>
      (a.kind === "project" && a.value === project.id) ||
      (a.kind === "board" &&
        (a.value === project.lh_board_id || a.value === project.lh_board_name))
  );
  if (owns) return null;
  const title = leadTitle(workspaceId, kind);
  return `"${project.name}" isn't in your area as ${title}, so ${tool} is refused there. Hand the work to the Tech lead with message_lead, or ask the owner to add the project to your area.`;
}

// What a chief's call does to work that already exists, said for the lead
// whose area it's in. Starts aren't here: the session they make records
// its starter, and that tells the lead (./area-notify).
const ACTED: Record<string, { verb: string; kind: "task" | "session" }> = {
  drop: { verb: "dropped", kind: "task" },
  pause_task: { verb: "paused", kind: "task" },
  resume_task: { verb: "resumed", kind: "task" },
  set_priority: { verb: "changed the priority of", kind: "task" },
  approve_plan: { verb: "approved the plan of", kind: "task" },
  plan_pieces: { verb: "edited the pieces of", kind: "task" },
  set_task_model: { verb: "changed the model of", kind: "task" },
  stop: { verb: "stopped", kind: "session" },
  archive: { verb: "archived", kind: "session" },
  resurrect: { verb: "brought back", kind: "session" },
  set_group: { verb: "regrouped", kind: "session" },
  send: { verb: "sent a message to", kind: "session" },
};

export function actedOn(
  workspaceId: string,
  tool: string,
  args: unknown
): { project: Project; what: string } | null {
  const act = ACTED[tool];
  if (!act) return null;
  const ref = str(((args ?? {}) as Args)[act.kind]);
  try {
    const s =
      act.kind === "task"
        ? workspaceTask(workspaceId, ref)
        : findWorkspaceSession(workspaceId, ref);
    const project = getProject(s.project_id ?? "");
    return project ? { project, what: `${act.verb} "${s.name}"` } : null;
  } catch {
    // The tool reports a target it can't find itself.
    return null;
  }
}
