// Migration 81: live task and session schedules become recipes with a timer
// (lib/recipes), and their runs become recipe runs. `migrated_from_kind` on
// the schedule row is what makes it reversible: revertSchedulesMove.
//
// A one-off (run_at) and an archived schedule are left as they are: a timer
// repeats, and history of archived ones stays where it was.

import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

interface ScheduleRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  name: string;
  prompt: string;
  kind: "task" | "session";
  created_by_session_id: string | null;
  created_at: string;
}

interface RunRow {
  id: number;
  trigger: string;
  session_id: string;
  created_at: string;
  task_status: string | null;
  pr_number: number | null;
  pr_url: string | null;
  session_exists: number;
}

const TRIGGER: Record<string, string> = {
  schedule: "timer",
  "catch-up": "catch-up",
  manual: "manual",
};

const FINAL: Record<string, string> = {
  merged: "succeeded",
  done: "succeeded",
  dropped: "failed",
};

// The name is unique among a workspace's live recipes, ignoring case.
function freeName(
  db: Database.Database,
  workspaceId: string,
  name: string
): string {
  const taken = db.prepare(
    `SELECT 1 FROM recipes WHERE workspace_id = ? AND archived_at IS NULL AND name = ? COLLATE NOCASE`
  );
  if (!taken.get(workspaceId, name)) return name;
  for (let n = 1; ; n++) {
    const candidate = `${name} (schedule${n > 1 ? ` ${n}` : ""})`;
    if (!taken.get(workspaceId, candidate)) return candidate;
  }
}

export function moveSchedulesToRecipes(db: Database.Database): {
  schedules: number;
  runs: number;
} {
  const sessionCols = (
    db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
  ).map((c) => c.name);
  const pr = sessionCols.includes("pr_number")
    ? "s.pr_number, s.pr_url"
    : "NULL AS pr_number, NULL AS pr_url";
  const hasTaskStatus = sessionCols.includes("task_status");

  const schedules = db
    .prepare(
      `SELECT id, workspace_id, project_id, name, prompt, kind, created_by_session_id, created_at
         FROM schedules
        WHERE archived_at IS NULL AND kind IN ('task','session')
          AND run_at IS NULL AND project_id IS NOT NULL
        ORDER BY created_at, id`
    )
    .all() as ScheduleRow[];

  const insertRecipe = db.prepare(
    `INSERT INTO recipes (id, workspace_id, project_id, name, kind, brief, model, view, created_by_session_id, updated_by_session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 'chat', ?, ?, ?)`
  );
  const insertRevision = db.prepare(
    `INSERT INTO recipe_revisions (recipe_id, brief, settings, edited_by_session_id) VALUES (?, ?, ?, ?)`
  );
  const switchSchedule = db.prepare(
    `UPDATE schedules SET kind = 'recipe', recipe_id = ?, migrated_from_kind = ?, updated_at = datetime('now') WHERE id = ?`
  );
  const runsOf = db.prepare(
    `SELECT r.id, r.trigger, r.session_id, r.created_at,
            ${hasTaskStatus ? "s.task_status" : "NULL"} AS task_status, ${pr},
            s.id IS NOT NULL AS session_exists
       FROM schedule_runs r LEFT JOIN sessions s ON s.id = r.session_id
      WHERE r.schedule_id = ? AND r.session_id IS NOT NULL
      ORDER BY r.id`
  );
  const insertRun = db.prepare(
    `INSERT INTO recipe_runs (recipe_id, seq, trigger, schedule_run_id, prompt, status, session_id, pr_number, pr_url, summary, started_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let movedRuns = 0;
  const move = db.transaction(() => {
    for (const s of schedules) {
      const recipeId = randomUUID();
      insertRecipe.run(
        recipeId,
        s.workspace_id,
        s.project_id,
        freeName(db, s.workspace_id, s.name),
        s.kind,
        s.prompt,
        s.created_by_session_id,
        s.created_by_session_id,
        s.created_at
      );
      insertRevision.run(
        recipeId,
        s.prompt,
        JSON.stringify({
          kind: s.kind,
          model: null,
          view: "chat",
          auto_done: true,
          max_minutes: null,
        }),
        s.created_by_session_id
      );
      switchSchedule.run(recipeId, s.kind, s.id);

      const runs = runsOf.all(s.id) as RunRow[];
      runs.forEach((r, i) => {
        // One live run per recipe: only the latest may still be running
        // (settle judges it); an earlier one with no recorded end is
        // closed as cancelled rather than guessed a result.
        const final = r.task_status ? FINAL[r.task_status] : undefined;
        const last = i === runs.length - 1;
        const status = final ?? (last ? "running" : "cancelled");
        insertRun.run(
          recipeId,
          i + 1,
          TRIGGER[r.trigger] ?? "timer",
          r.id,
          s.prompt,
          status,
          r.session_id,
          r.pr_number,
          r.pr_url,
          status === "cancelled"
            ? "Ran before recipes; its outcome wasn't recorded"
            : null,
          r.created_at,
          r.created_at
        );
        movedRuns++;
      });
    }
  });
  move();
  return { schedules: schedules.length, runs: movedRuns };
}

// Undo the move: each moved schedule gets its old kind (and the brief as it
// stands now) back, and the recipes the move made go, with their runs and
// revisions. The runs stay in schedule_runs, which the move never touched.
// Migration 81 stays recorded as applied, so a restart doesn't redo it.
export function revertSchedulesMove(db: Database.Database): {
  schedules: number;
} {
  const moved = db
    .prepare(
      `SELECT id, recipe_id, migrated_from_kind FROM schedules WHERE migrated_from_kind IS NOT NULL`
    )
    .all() as {
    id: string;
    recipe_id: string | null;
    migrated_from_kind: string;
  }[];
  const recipe = db.prepare(
    `SELECT brief, project_id FROM recipes WHERE id = ?`
  );
  const restore = db.prepare(
    `UPDATE schedules SET kind = ?, recipe_id = NULL, migrated_from_kind = NULL,
       prompt = COALESCE(?, prompt), project_id = COALESCE(?, project_id), updated_at = datetime('now')
     WHERE id = ?`
  );
  const drop = (table: string) =>
    db.prepare(`DELETE FROM ${table} WHERE recipe_id = ?`);
  const [dropRuns, dropRevisions] = [
    drop("recipe_runs"),
    drop("recipe_revisions"),
  ];
  const dropRecipe = db.prepare(`DELETE FROM recipes WHERE id = ?`);

  db.transaction(() => {
    for (const s of moved) {
      const r = s.recipe_id
        ? (recipe.get(s.recipe_id) as
            | { brief: string; project_id: string }
            | undefined)
        : undefined;
      restore.run(
        s.migrated_from_kind,
        r?.brief ?? null,
        r?.project_id ?? null,
        s.id
      );
      if (s.recipe_id) {
        dropRuns.run(s.recipe_id);
        dropRevisions.run(s.recipe_id);
        dropRecipe.run(s.recipe_id);
      }
    }
  })();
  return { schedules: moved.length };
}
