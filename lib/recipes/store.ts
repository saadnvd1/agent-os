import { randomUUID } from "crypto";
import { db } from "../db";
import { getProject } from "../projects";
import { getWorkspace } from "../workspaces";
import { parseOverride, type ModelOverride } from "../models/resolve";
import {
  MAX_BRIEF,
  MAX_NAME,
  RECIPE_KINDS,
  isLive,
  type Recipe,
  type RecipeInput,
  type RecipeRun,
  type RecipeTotals,
  type RunStatus,
} from "./types";

type RecipeRow = Omit<Recipe, "auto_done"> & { auto_done: number };
const toRecipe = (r: RecipeRow): Recipe => ({ ...r, auto_done: !!r.auto_done });

type RunRow = Omit<RecipeRun, "outputs"> & { outputs: string | null };
export const toRun = (r: RunRow): RecipeRun => ({
  ...r,
  outputs: r.outputs ? (JSON.parse(r.outputs) as Record<string, string>) : null,
});

export function getRecipe(id: string): Recipe | null {
  const row = db.prepare(`SELECT * FROM recipes WHERE id = ?`).get(id) as
    RecipeRow | undefined;
  return row ? toRecipe(row) : null;
}

export function listRecipes(workspaceId?: string | null): Recipe[] {
  const rows = (
    workspaceId
      ? db
          .prepare(
            `SELECT * FROM recipes WHERE archived_at IS NULL AND workspace_id = ? ORDER BY name COLLATE NOCASE`
          )
          .all(workspaceId)
      : db
          .prepare(
            `SELECT * FROM recipes WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE`
          )
          .all()
  ) as RecipeRow[];
  return rows.map(toRecipe);
}

// By id, id prefix or name (case-insensitive) among a workspace's live
// recipes. Never reaches another workspace's.
export function findRecipe(workspaceId: string, ref: string): Recipe {
  const r = ref.trim();
  const live = listRecipes(workspaceId);
  const byId = live.filter(
    (x) => x.id === r || (r.length >= 6 && x.id.startsWith(r))
  );
  const matches = byId.length
    ? byId
    : live.filter((x) => x.name.toLowerCase() === r.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (matches.length)
    throw new Error(`"${ref}" matches several recipes; use its id`);
  const names = live.map((x) => x.name).join(", ") || "none";
  throw new Error(`No recipe "${ref}" in this workspace (recipes: ${names})`);
}

export const modelOf = (r: Pick<Recipe, "model">): ModelOverride | null =>
  !r.model
    ? null
    : r.model.startsWith("{")
      ? (JSON.parse(r.model) as ModelOverride)
      : r.model;

function validate(
  input: RecipeInput,
  selfId?: string
): Required<Omit<RecipeInput, "sourceSessionId">> {
  const name = input.name?.trim();
  if (!name) throw new Error("Give the recipe a name");
  if (name.length > MAX_NAME)
    throw new Error(`Keep the name under ${MAX_NAME} characters`);
  // It's quoted inside the run's first message.
  if (/["[\]\n]/.test(name))
    throw new Error("A recipe name can't use quotes or [ ]");
  const brief = input.brief?.trim();
  if (!brief) throw new Error("Write the brief it runs");
  if (brief.length > MAX_BRIEF)
    throw new Error(
      `Keep the brief under ${MAX_BRIEF} characters: put the steps in a script in the repo and have the brief run it`
    );
  if (!RECIPE_KINDS.includes(input.kind))
    throw new Error("Pick task or session");
  if (!getWorkspace(input.workspaceId)) throw new Error("Pick a workspace");
  const project = input.projectId ? getProject(input.projectId) : null;
  if (!project || project.is_uncategorized) throw new Error("Pick a project");
  if (project.workspace_id !== input.workspaceId)
    throw new Error(`${project.name} isn't in this workspace`);
  if (project.host_id && project.host_id !== "local")
    throw new Error("Recipes run on this machine's projects only");
  const view = input.view ?? "chat";
  if (view !== "chat" && view !== "terminal")
    throw new Error("view: chat or terminal");
  let model: string | null = null;
  const parsed = parseOverride(input.model);
  if (parsed) {
    if (input.kind === "session" && typeof parsed !== "string")
      throw new Error(`model: a session takes one "provider/model"`);
    model = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
  }
  const maxMinutes = input.maxMinutes ?? null;
  if (
    maxMinutes !== null &&
    (!Number.isInteger(maxMinutes) || maxMinutes < 1 || maxMinutes > 1440)
  )
    throw new Error("Time limit: 1 to 1440 minutes");
  const clash = db
    .prepare(
      `SELECT name FROM recipes WHERE workspace_id = ? AND archived_at IS NULL
         AND name = ? COLLATE NOCASE AND id != ?`
    )
    .get(input.workspaceId, name, selfId ?? "") as { name: string } | undefined;
  if (clash) throw new Error(`There's already a recipe called "${clash.name}"`);
  return {
    workspaceId: input.workspaceId,
    projectId: project.id,
    name,
    kind: input.kind,
    brief,
    model,
    view,
    autoDone: input.autoDone ?? true,
    maxMinutes,
  };
}

function settingsOf(v: {
  kind: string;
  model: string | null;
  view: string;
  autoDone: boolean;
  maxMinutes: number | null;
}) {
  return JSON.stringify({
    kind: v.kind,
    model: v.model,
    view: v.view,
    auto_done: v.autoDone,
    max_minutes: v.maxMinutes,
  });
}

function addRevision(
  recipeId: string,
  brief: string,
  settings: string,
  by: string | null
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO recipe_revisions (recipe_id, brief, settings, edited_by_session_id) VALUES (?, ?, ?, ?)`
      )
      .run(recipeId, brief, settings, by).lastInsertRowid
  );
}

// `by`: the agent session that wrote it, or null for Saad.
export function createRecipe(
  input: RecipeInput,
  by: string | null = null
): Recipe {
  const v = validate(input);
  const id = randomUUID();
  const make = db.transaction(() => {
    db.prepare(
      `INSERT INTO recipes (id, workspace_id, project_id, name, kind, brief, model, view, auto_done, max_minutes,
         source_session_id, created_by_session_id, updated_by_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      v.workspaceId,
      v.projectId,
      v.name,
      v.kind,
      v.brief,
      v.model,
      v.view,
      v.autoDone ? 1 : 0,
      v.maxMinutes,
      input.sourceSessionId ?? null,
      by,
      by
    );
    addRevision(id, v.brief, settingsOf(v), by);
  });
  make();
  return getRecipe(id)!;
}

export function updateRecipe(
  id: string,
  patch: Partial<Omit<RecipeInput, "workspaceId" | "sourceSessionId">>,
  by: string | null = null
): Recipe {
  const current = getRecipe(id);
  if (!current || current.archived_at) throw new Error("Recipe not found");
  const v = validate(
    {
      workspaceId: current.workspace_id,
      projectId: patch.projectId ?? current.project_id,
      name: patch.name ?? current.name,
      kind: patch.kind ?? current.kind,
      brief: patch.brief ?? current.brief,
      model: patch.model === undefined ? current.model : patch.model,
      view: patch.view ?? current.view,
      autoDone: patch.autoDone ?? current.auto_done,
      maxMinutes:
        patch.maxMinutes === undefined ? current.max_minutes : patch.maxMinutes,
    },
    id
  );
  const settings = settingsOf(v);
  const before = settingsOf({
    kind: current.kind,
    model: current.model,
    view: current.view,
    autoDone: current.auto_done,
    maxMinutes: current.max_minutes,
  });
  db.transaction(() => {
    db.prepare(
      `UPDATE recipes SET project_id = ?, name = ?, kind = ?, brief = ?, model = ?, view = ?, auto_done = ?,
         max_minutes = ?, updated_by_session_id = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      v.projectId,
      v.name,
      v.kind,
      v.brief,
      v.model,
      v.view,
      v.autoDone ? 1 : 0,
      v.maxMinutes,
      by,
      id
    );
    if (v.brief !== current.brief || settings !== before)
      addRevision(id, v.brief, settings, by);
    db.prepare(
      `UPDATE schedules SET name = ?, project_id = ?, updated_at = datetime('now') WHERE recipe_id = ?`
    ).run(v.name, v.projectId, id);
  })();
  return getRecipe(id)!;
}

// History stays: the recipe leaves the list and its timer turns off.
export function archiveRecipe(id: string): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE recipes SET archived_at = datetime('now') WHERE id = ? AND archived_at IS NULL`
    ).run(id);
    db.prepare(
      `UPDATE schedules SET enabled = 0, archived_at = datetime('now') WHERE recipe_id = ? AND archived_at IS NULL`
    ).run(id);
  })();
}

// "Clear" on the last-run card: the next run starts without a carry block.
export function clearCarry(id: string, now = Date.now()): void {
  db.prepare(`UPDATE recipes SET carry_cleared_at = ? WHERE id = ?`).run(
    now,
    id
  );
}

export function lastRevisionId(recipeId: string): number | null {
  const row = db
    .prepare(
      `SELECT id FROM recipe_revisions WHERE recipe_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(recipeId) as { id: number } | undefined;
  return row?.id ?? null;
}

export function getRun(id: number): RecipeRun | null {
  const row = db.prepare(`SELECT * FROM recipe_runs WHERE id = ?`).get(id) as
    RunRow | undefined;
  return row ? toRun(row) : null;
}

export function runForSession(sessionId: string): RecipeRun | null {
  const row = db
    .prepare(`SELECT * FROM recipe_runs WHERE session_id = ?`)
    .get(sessionId) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function listRuns(
  recipeId: string,
  opts: { before?: number; limit?: number } = {}
): RecipeRun[] {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const rows = db
    .prepare(
      `SELECT * FROM recipe_runs WHERE recipe_id = ? AND id < ? ORDER BY id DESC LIMIT ?`
    )
    .all(recipeId, opts.before ?? Number.MAX_SAFE_INTEGER, limit) as RunRow[];
  return rows.map(toRun);
}

export function liveRun(recipeId: string): RecipeRun | null {
  const row = db
    .prepare(
      `SELECT * FROM recipe_runs WHERE recipe_id = ? AND status IN ('queued','starting','running')`
    )
    .get(recipeId) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function lastRun(recipeId: string): RecipeRun | null {
  return listRuns(recipeId, { limit: 1 })[0] ?? null;
}

// The newest settled run with this status, after the carry was last cleared.
export function lastSettled(
  recipeId: string,
  clearedAt: number | null,
  status?: RunStatus
): RecipeRun | null {
  const row = db
    .prepare(
      `SELECT * FROM recipe_runs WHERE recipe_id = ?
         AND status NOT IN ('queued','starting','running','skipped','cancelled')
         ${status ? "AND status = ?" : ""}
         ${clearedAt ? "AND strftime('%s', COALESCE(ended_at, created_at)) * 1000 > ?" : ""}
       ORDER BY id DESC LIMIT 1`
    )
    .get(
      ...[
        recipeId,
        ...(status ? [status] : []),
        ...(clearedAt ? [clearedAt] : []),
      ]
    ) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function totals(recipeId: string): RecipeTotals {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS runs,
         SUM(status = 'succeeded') AS succeeded,
         SUM(status IN ('failed','blocked','timed_out')) AS failed,
         COALESCE(SUM(cost_usd), 0) AS cost,
         AVG(duration_ms) AS avg_ms
       FROM recipe_runs WHERE recipe_id = ? AND status NOT IN ('skipped','cancelled')`
    )
    .get(recipeId) as {
    runs: number;
    succeeded: number | null;
    failed: number | null;
    cost: number;
    avg_ms: number | null;
  };
  return {
    runs: row.runs,
    succeeded: row.succeeded ?? 0,
    failed: row.failed ?? 0,
    costUsd: row.cost,
    avgMs: row.avg_ms === null ? null : Math.round(row.avg_ms),
  };
}

export { isLive };

export const hasLiveRun = (recipeId: string): boolean => !!liveRun(recipeId);
