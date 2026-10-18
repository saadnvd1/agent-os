import type { Migration } from "../migration-types";

export default {
  key: "20261018T2130_project_tier",
  up: (db) => {
    // A project's tier: "production" tasks pass every merge gate, "fast"
    // ones merge as soon as their PR opens (orchestrator/fast-lane.ts). The
    // LumifyHub and Workstak projects start production, in the same step as
    // the column, so running this again never overwrites a tier Saad changed.
    const cols = db.prepare(`PRAGMA table_info(projects)`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "tier")) {
      db.exec(
        `ALTER TABLE projects ADD COLUMN tier TEXT NOT NULL DEFAULT 'fast'`
      );
      db.exec(
        `UPDATE projects SET tier = 'production'
         WHERE lower(name) LIKE 'lumifyhub%' OR lower(name) LIKE 'workstak%'
            OR workspace_id IN (
              SELECT id FROM workspaces WHERE lower(name) IN ('lumifyhub', 'workstak')
            )`
      );
    }
    // What the fast lane has done to a task: the PR it armed (so a disarm
    // sticks) and the merge whose CI it still watches.
    db.exec(`CREATE TABLE IF NOT EXISTS fast_lane_tasks (
      session_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      auto_armed_pr INTEGER,
      merged_sha TEXT,
      merged_pr INTEGER,
      merged_at TEXT,
      ci_checked_at TEXT,
      ci_done_at TEXT
    )`);
  },
} satisfies Migration;
