import type { Migration } from "../migration-types";

export default {
  key: "20261020T1400_work_claims",
  up: (db) => {
    // What each live session, here or on a linked machine, is working on:
    // repo, branch, goal and the paths of its diff. Never code. Times are
    // this machine's clock in ms; they cross the wire as durations.
    db.exec(`
      CREATE TABLE IF NOT EXISTS work_claims (
        id TEXT PRIMARY KEY,
        origin TEXT NOT NULL,
        origin_name TEXT NOT NULL,
        via_machine TEXT,
        hops INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL,
        session_id TEXT,
        session_name TEXT,
        repo TEXT NOT NULL,
        branch TEXT,
        base TEXT,
        goal TEXT NOT NULL,
        files TEXT NOT NULL DEFAULT '[]',
        files_more INTEGER NOT NULL DEFAULT 0,
        pr_url TEXT,
        started_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        released TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_work_claims_repo ON work_claims (repo, expires_at);
      CREATE INDEX IF NOT EXISTS idx_work_claims_session ON work_claims (session_id);
    `);
  },
} satisfies Migration;
