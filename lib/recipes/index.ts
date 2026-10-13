import { db } from "../db";
import { getProject } from "../projects";
import { composePrompt } from "./compose";
import { getRecipe, lastRun, listRecipes, liveRun, totals } from "./store";
import { getTimer } from "./timer";
import type { Recipe, RecipeView } from "./types";

export * from "./types";
export {
  archiveRecipe,
  clearCarry,
  createRecipe,
  findRecipe,
  getRecipe,
  getRun,
  listRecipes,
  listRuns,
  runForSession,
  updateRecipe,
} from "./store";
export { startRun, AlreadyRunning } from "./run";
export { getTimer, setTimer } from "./timer";
export { settleRuns, startSettling } from "./settle";

export function recipeView(recipe: Recipe, now = Date.now()): RecipeView {
  return {
    ...recipe,
    projectName: getProject(recipe.project_id)?.name ?? null,
    lastRun: lastRun(recipe.id),
    liveRun: liveRun(recipe.id),
    timer: getTimer(recipe.id, now),
    totals: totals(recipe.id),
  };
}

export const listRecipeViews = (workspaceId?: string | null): RecipeView[] =>
  listRecipes(workspaceId).map((r) => recipeView(r));

// What a run started now would send: the Run sheet's preview.
export function previewPrompt(id: string, note?: string | null): string {
  const recipe = getRecipe(id);
  if (!recipe || recipe.archived_at) throw new Error("Recipe not found");
  return composePrompt(recipe, { seq: nextSeq(id), trigger: "manual", note });
}

function nextSeq(id: string): number {
  return (
    db
      .prepare(
        `SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM recipe_runs WHERE recipe_id = ?`
      )
      .get(id) as { n: number }
  ).n;
}
