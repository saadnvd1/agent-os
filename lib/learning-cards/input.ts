// Reads one finished session into the plain object the scripts take: the
// brief, the final report and the tool and user steps, each cut down.
// Never the transcript.

import { db, queries, type Session } from "../db";
import { itemsOfKind, itemsOfKinds } from "../chat/store";
import { isGitRepo } from "../git";
import { getProject } from "../projects";
import { finalMessage } from "../session-logs/gather";
import { getRecipe, listRuns, runForSession } from "../recipes/store";
import { isLive, type RecipeRun } from "../recipes/types";
import type { RunInfo, SessionInput, Step } from "./types";

const CUT = 300;
const BRIEF = 1500;
const FINAL = 2000;
const RECENT_DAYS = 60;
const RECENT_BRIEFS = 200;

const cut = (s: string, n = CUT) => s.slice(0, n);

function stepOf(item: ReturnType<typeof itemsOfKinds>[number]): Step | null {
  if (item.kind === "user") {
    const byPerson = !item.peer && !item.from && !item.origin;
    return { kind: "user", text: cut(item.text), byPerson };
  }
  if (item.kind !== "tool") return null;
  const input = (item.input ?? {}) as Record<string, unknown>;
  const command = typeof input.command === "string" ? input.command : "";
  const path = typeof input.file_path === "string" ? input.file_path : "";
  return {
    kind: "tool",
    name: item.name,
    ok: item.status === "done",
    failed: item.status === "error",
    command: cut(command),
    path,
    input: cut(command || path || JSON.stringify(item.input ?? "")),
    output: (item.output ?? "").slice(-CUT),
  };
}

const runInfo = (r: RecipeRun): RunInfo => ({
  status: r.status,
  summary: r.summary ?? "",
  error: r.error ?? "",
  settled: !isLive(r.status),
});

export async function readSession(id: string): Promise<SessionInput | null> {
  const s = queries.getSession(db).get(id) as Session | undefined;
  if (!s) return null;
  const project = s.project_id ? getProject(s.project_id) : null;
  const workspaceId = project?.workspace_id ?? s.workspace_id ?? null;
  const steps = itemsOfKinds(id, ["user", "tool"])
    .map(stepOf)
    .filter((x): x is Step => !!x);
  const final = finalMessage(id) ?? "";
  const brief = (s.task_prompt || itemsOfKind(id, "user")[0]?.text || "").slice(
    0,
    BRIEF
  );
  let skip: string | null = null;
  if (s.role === "orchestrator") skip = "orchestrator";
  else if (s.quick_of) skip = "quick change";
  else if (!steps.length && !final) skip = "no conversation";

  const run = runForSession(id);
  const previous = run
    ? listRuns(run.recipe_id, { before: run.id, limit: 5 }).find(
        (r) =>
          !isLive(r.status) &&
          r.status !== "cancelled" &&
          r.status !== "skipped"
      )
    : undefined;
  const recipe = run ? getRecipe(run.recipe_id) : null;

  const recentBriefs = workspaceId
    ? (
        db
          .prepare(
            `SELECT s.task_prompt AS p FROM session_rows s JOIN projects p ON p.id = s.project_id
             WHERE p.workspace_id = ? AND s.id != ? AND s.quick_of IS NULL
               AND s.task_prompt IS NOT NULL
               AND s.created_at >= datetime('now', ?)
             ORDER BY s.created_at DESC LIMIT ?`
          )
          .all(workspaceId, id, `-${RECENT_DAYS} days`, RECENT_BRIEFS) as {
          p: string;
        }[]
      ).map((r) => r.p)
    : [];

  return {
    id,
    name: s.name,
    workspaceId,
    projectId: s.project_id ?? null,
    skip,
    brief,
    final: final.slice(-FINAL),
    steps,
    reviews: db
      .prepare(
        `SELECT status, COALESCE(detail, '') AS detail FROM orchestrator_checks
         WHERE session_id = ? AND kind = 'review' ORDER BY created_at, id`
      )
      .all(id) as { status: string; detail: string }[],
    // The project's own folder: a task's worktree is gone once it's merged.
    inRepo: await isGitRepo(project?.working_directory ?? s.working_directory),
    run: run && recipe ? { ...runInfo(run), recipeId: recipe.id } : null,
    previousRun: previous ? runInfo(previous) : null,
    recentBriefs,
  };
}
