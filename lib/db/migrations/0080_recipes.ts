import type { Migration } from "../migration-types";
import { installChangeTriggers, TABLES_WATCHED_80 } from "../changes";

export default {
  id: 80,
  name: "recipes",
  up: (db) => {
    // Recipes: a saved brief that starts a fresh task or session each run
    // (lib/recipes), and the features a plan splits into pieces
    // (lib/plans). All additive. A run or piece finds its session by
    // session_id, so sessions gains no column.
    db.exec(`
        CREATE TABLE IF NOT EXISTS recipes (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          brief TEXT NOT NULL,
          model TEXT,
          view TEXT NOT NULL DEFAULT 'chat',
          auto_done INTEGER NOT NULL DEFAULT 1,
          max_minutes INTEGER,
          carry_cleared_at INTEGER,
          source_session_id TEXT,
          created_by_session_id TEXT,
          updated_by_session_id TEXT,
          archived_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_name
          ON recipes(workspace_id, name COLLATE NOCASE) WHERE archived_at IS NULL;

        CREATE TABLE IF NOT EXISTS recipe_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipe_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          trigger TEXT NOT NULL,
          triggered_by_session_id TEXT,
          schedule_run_id INTEGER,
          request_id TEXT,
          note TEXT,
          prompt TEXT NOT NULL,
          revision_id INTEGER,
          status TEXT NOT NULL,
          session_id TEXT,
          pr_number INTEGER,
          pr_url TEXT,
          summary TEXT,
          outputs TEXT,
          summary_source TEXT,
          error TEXT,
          cost_usd REAL,
          duration_ms INTEGER,
          started_at TEXT,
          ended_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (recipe_id, seq)
        );
        CREATE INDEX IF NOT EXISTS idx_recipe_runs_recipe
          ON recipe_runs(recipe_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_recipe_runs_session
          ON recipe_runs(session_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_runs_one_live
          ON recipe_runs(recipe_id)
          WHERE status IN ('queued','starting','running');
        CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_runs_request
          ON recipe_runs(request_id) WHERE request_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS recipe_revisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipe_id TEXT NOT NULL,
          brief TEXT NOT NULL,
          settings TEXT NOT NULL,
          edited_by_session_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS features (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL,
          plan_session_id TEXT NOT NULL,
          plan_text TEXT NOT NULL,
          status TEXT NOT NULL,
          done_at TEXT,
          cost_usd REAL,
          duration_ms INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_features_plan
          ON features(plan_session_id);

        CREATE TABLE IF NOT EXISTS feature_pieces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          feature_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          name TEXT NOT NULL,
          slice TEXT NOT NULL,
          project_id TEXT NOT NULL,
          after_position INTEGER,
          after_kind TEXT,
          reasons TEXT,
          owns TEXT,
          status TEXT NOT NULL,
          session_id TEXT,
          note TEXT,
          UNIQUE (feature_id, position)
        );
        CREATE INDEX IF NOT EXISTS idx_feature_pieces_session
          ON feature_pieces(session_id);
      `);
    const cols = (
      db.prepare(`PRAGMA table_info(schedules)`).all() as { name: string }[]
    ).map((c) => c.name);
    if (!cols.includes("recipe_id"))
      db.exec(`ALTER TABLE schedules ADD COLUMN recipe_id TEXT`);
    if (!cols.includes("migrated_from_kind"))
      db.exec(`ALTER TABLE schedules ADD COLUMN migrated_from_kind TEXT`);
    const plan = (
      db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
    ).map((c) => c.name);
    // Edits Saad made to a plan's pieces before approving it (merge, drop).
    if (!plan.includes("plan_edits"))
      db.exec(`ALTER TABLE sessions ADD COLUMN plan_edits TEXT`);
    installChangeTriggers(db, TABLES_WATCHED_80);
  },
} satisfies Migration;
