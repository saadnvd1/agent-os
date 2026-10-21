import type { Migration } from "../migration-types";
import { installChangeTriggers, TABLES_WATCHED_LOOPS } from "../changes";

export default {
  key: "20261021T1600_task_loops",
  up: (db) => {
    // The developer-analyst loop (lib/loops): one loop per run on a task, its
    // acceptance checklist, and one row per cycle. Rows are kept for good.
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_loops (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT,
        state TEXT NOT NULL DEFAULT 'running',
        stop_reason TEXT,
        stop_detail TEXT,
        goal TEXT NOT NULL DEFAULT '',
        max_cycles INTEGER NOT NULL,
        max_cost_usd REAL NOT NULL,
        max_minutes INTEGER NOT NULL,
        grace_seconds INTEGER NOT NULL,
        stall_cycles INTEGER NOT NULL,
        repeat_cycles INTEGER NOT NULL,
        cost_base_usd REAL NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        last_cycle_at INTEGER,
        run_now INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS task_loops_live
        ON task_loops(session_id) WHERE state = 'running';
      CREATE INDEX IF NOT EXISTS task_loops_session
        ON task_loops(session_id, started_at);
      CREATE TABLE IF NOT EXISTS task_loop_criteria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        loop_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        text TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        evidence_kind TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        evidence TEXT,
        verified INTEGER NOT NULL DEFAULT 1,
        met_cycle INTEGER,
        waived_by TEXT,
        removed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS task_loop_criteria_loop
        ON task_loop_criteria(loop_id, position);
      CREATE TABLE IF NOT EXISTS task_loop_cycles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        loop_id TEXT NOT NULL,
        n INTEGER NOT NULL,
        trigger TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'claimed',
        snapshot_sha TEXT,
        tree TEXT,
        changed INTEGER NOT NULL DEFAULT 1,
        evidence TEXT,
        log_path TEXT,
        analysis TEXT,
        signature TEXT,
        score TEXT,
        instruction TEXT,
        instruction_sent TEXT,
        sender TEXT,
        delivery TEXT,
        send_at INTEGER,
        input TEXT,
        cost_usd REAL NOT NULL DEFAULT 0,
        error TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS task_loop_cycles_n
        ON task_loop_cycles(loop_id, n);
    `);
    // The loop view refetches when any of them changes.
    installChangeTriggers(db, TABLES_WATCHED_LOOPS);
  },
} satisfies Migration;
