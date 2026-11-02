/**
 * The orchestrator's recipe tools: list, run, save and edit. A recipe is a
 * saved brief, never an approval: a run goes through the same brakes, gates,
 * Pause and task queue as a task the orchestrator started itself. It sets no
 * trigger; timers are Saad's.
 */

import { formatRunTime } from "../schedules/cron";
import { workspaceProject } from "./targets";
import { getOrchestrator } from "./home";
import { untrusted } from "./untrusted";
import {
  AlreadyRunning,
  createRecipe,
  findRecipe,
  getTimer,
  listRecipes,
  listRuns,
  startRun,
  updateRecipe,
  type Recipe,
  type RecipeRun,
} from "../recipes";
import { outputsText } from "../recipes/result";
import { owner } from "../owner";

const when = (iso: string | null) =>
  iso
    ? formatRunTime(Date.parse(`${iso.replace(" ", "T")}Z`) || Date.now())
    : "?";

function runLine(r: RecipeRun, recipe: Recipe): string {
  const facts = outputsText(r.outputs);
  const bits = [facts, r.summary].filter(Boolean).join(". ");
  const text = bits ? `: ${untrusted(recipe.name, bits)}` : "";
  const pr = r.pr_number ? ` PR #${r.pr_number}` : "";
  const by =
    r.trigger === "timer" || r.trigger === "catch-up"
      ? "timer"
      : r.trigger === "tool"
        ? "you"
        : owner();
  return `#${r.seq} ${r.status} (${when(r.ended_at ?? r.started_at ?? r.created_at)}, by ${by})${pr}${text}`;
}

function summaryLine(recipe: Recipe): string {
  const [last] = listRuns(recipe.id, { limit: 1 });
  const timer = getTimer(recipe.id);
  const next =
    timer?.enabled && timer.nextRunAt
      ? `, next ${formatRunTime(timer.nextRunAt, timer.timezone)}`
      : "";
  return `- "${recipe.name}" (${recipe.kind}${last ? `; last ${runLine(last, recipe)}` : "; never run"}${next})`;
}

// `recipes`: every recipe, or one in full with its brief and recent runs.
export function recipesText(w: string, name?: string): string {
  if (name) {
    const r = findRecipe(w, name);
    const timer = getTimer(r.id);
    const runs = listRuns(r.id, { limit: 5 });
    return [
      `Recipe "${r.name}" (${r.kind}, ${r.view}, project ${projectName(w, r)})${r.model ? `, model ${r.model}` : ""}${r.max_minutes ? `, time limit ${r.max_minutes} min` : ""}.`,
      timer
        ? `Timer: ${timer.description} ${timer.timezone}${timer.enabled ? "" : " (off)"}, set by ${owner()}.`
        : "No timer.",
      `Brief:\n${r.brief}`,
      runs.length
        ? `Recent runs:\n${runs.map((x) => `- ${runLine(x, r)}`).join("\n")}`
        : "Never run.",
    ].join("\n");
  }
  const all = listRecipes(w);
  if (!all.length)
    return "No recipes yet. Save one with recipe_save when a job comes up a second time.";
  return all.map(summaryLine).join("\n");
}

const projectName = (w: string, r: Recipe) =>
  workspaceProject(w, r.project_id).name;

export async function runRecipe(
  w: string,
  name: string,
  note?: string
): Promise<string> {
  const recipe = findRecipe(w, name);
  const orchestrator = getOrchestrator(w);
  try {
    const { run, queued } = await startRun(recipe.id, {
      trigger: "tool",
      actorSessionId: orchestrator?.id ?? null,
      note,
    });
    return queued
      ? `Queued run #${run.seq} of "${recipe.name}" behind the task limit; it starts by itself. You'll get an event when it finishes.`
      : `Started run #${run.seq} of "${recipe.name}" (${recipe.kind}). You'll get an event when it finishes${recipe.kind === "task" ? "; its PR goes through the gates like any task's" : ""}.`;
  } catch (error) {
    if (error instanceof AlreadyRunning)
      return `"${recipe.name}" already has run #${error.run.seq} going. Not starting another; you'll get an event when it finishes.`;
    throw error;
  }
}

export function saveRecipe(
  w: string,
  a: {
    name: string;
    project: string;
    kind: "task" | "session";
    brief: string;
    model?: string;
    view?: "chat" | "terminal";
  }
): string {
  const project = workspaceProject(w, a.project);
  const orchestrator = getOrchestrator(w);
  const recipe = createRecipe(
    {
      workspaceId: w,
      projectId: project.id,
      name: a.name,
      kind: a.kind,
      brief: a.brief,
      model: a.model,
      view: a.view,
    },
    orchestrator?.id ?? null
  );
  return `Saved recipe "${recipe.name}" (${recipe.kind}, ${project.name}). Run it with run_recipe; ${owner()} sees it in Recipes and sets any timer.`;
}

export function updateRecipeTool(
  w: string,
  a: {
    name: string;
    brief?: string;
    new_name?: string;
    model?: string;
    view?: "chat" | "terminal";
    auto_done?: boolean;
    max_minutes?: number;
  }
): string {
  const recipe = findRecipe(w, a.name);
  const orchestrator = getOrchestrator(w);
  updateRecipe(
    recipe.id,
    {
      brief: a.brief,
      name: a.new_name,
      model: a.model,
      view: a.view,
      autoDone: a.auto_done,
      maxMinutes: a.max_minutes,
    },
    orchestrator?.id ?? null
  );
  return `Updated recipe "${a.new_name ?? recipe.name}". Earlier versions of the brief are kept; ${owner()} sees the change.`;
}
