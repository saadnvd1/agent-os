import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import {
  PART_COLUMNS,
  PART_TABLES,
  SESSION_ROW_COLUMNS,
} from "./session-parts";

const BEFORE = "20261015T1600_plan_waits_for_caller";

type Row = Record<string, string | number | null>;

// Rows shaped like real ones, with made-up values.
const ROWS: Row[] = [
  {
    id: "plain",
    name: "scratch",
    tmux_name: "claude-plain",
    working_directory: "/work/app",
  },
  {
    id: "orch",
    name: "Orchestrator",
    tmux_name: "claude-orch",
    working_directory: "/work/app",
    view: "chat",
    role: "orchestrator",
    orch_token: "tok-not-real",
  },
  {
    id: "running",
    name: "Add export",
    tmux_name: "claude-running",
    working_directory: "/work/app-add-export",
    worktree_path: "/work/app-add-export",
    branch_name: "feature/add-export",
    base_branch: "main",
    task_prompt: "Add a CSV export to the report page.",
    task_brief: "Brief: export the table as CSV; keep the filters.",
    task_status: "running",
    task_since: "2026-10-14 09:00:00",
    priority: "high",
    model_overrides: '{"plan":"provider/model-a"}',
    lh_card_id: "card-7",
    lh_board_id: "board-2",
    lh_card_list: "Doing",
    started_by: "orch",
    started_via: "orchestrator",
    plan_phase: "awaiting",
    plan_only: 1,
    plan_decided: 1,
    plan_reason: "touches the report API",
    plan_note: "Plan written: 3 steps",
    plan_edits: '{"merged":[[1,2]],"dropped":[]}',
    plan_waits_for_caller: 1,
    plan_handoff_message: "Go ahead, keep it small.",
    held_by_device: "device-a",
    held_from: "machine-a",
    held_for: "orch-remote",
    held_for_name: "Orchestrator",
    started_by_device: "device-b",
    placed_note: "placed on machine-b",
  },
  {
    id: "merged",
    name: "Fix typo",
    tmux_name: "claude-merged",
    working_directory: "/work/app-typo",
    task_prompt: "Fix the typo in the header.",
    task_status: "merged",
    merged_at: "2026-10-14 12:00:00",
    task_ended_at: null,
    pr_url: "https://example.test/org/app/pull/41",
    pr_number: 41,
    pr_status: "merged",
    merge_armed_at: "2026-10-14 11:50:00",
    merge_armed_seen: "checks failing",
    rebased_from: "aaa111",
    rebased_to: "bbb222",
    rebase_asked_head: "ccc333",
    pr_wake_since: "2026-10-14 11:00:00",
  },
  {
    id: "paused",
    name: "Slow refactor",
    tmux_name: "claude-paused",
    working_directory: "/work/app-refactor",
    task_prompt: "Refactor the loader.",
    task_status: "running",
    pause_state: "paused",
    paused_until: "2026-10-16 08:00:00",
    pause_id: 12,
    pause_note: "waiting for the window",
  },
  {
    id: "mirror",
    name: "Remote task",
    tmux_name: "claude-mirror",
    working_directory: "/remote/app",
    host_id: "remote-1",
    task_prompt: "Add a retry.",
    task_status: "running",
    pr_url: "https://example.test/org/app/pull/42",
    pr_number: 42,
    pr_status: "open",
    peer_mirror: 1,
  },
  {
    id: "moved",
    name: "Moved away",
    tmux_name: "claude-moved",
    working_directory: "/work/app-moved",
    task_prompt: "Move me.",
    task_status: "moved",
    task_ended_at: "2026-10-14 13:00:00",
    moved_to: "remote-1",
    moved_from: "other-session",
    quick_of: "orch",
    plan_phase: "implementing",
  },
];

function seed(db: Database.Database) {
  for (const row of ROWS) {
    const cols = Object.keys(row);
    db.prepare(
      `INSERT INTO sessions (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
    ).run(...Object.values(row));
  }
}

function migrated(upTo?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "split-sessions-"));
  const db = new Database(path.join(dir, "old.db"));
  createSchema(db);
  runMigrations(db, upTo ?? BEFORE);
  return db;
}

describe("split sessions into focused tables", () => {
  it("backfills every moved value into its table and changes nothing on sessions", () => {
    const db = migrated();
    seed(db);
    const before = db.prepare(`SELECT * FROM sessions ORDER BY id`).all();

    runMigrations(db);
    runMigrations(db);

    expect(db.prepare(`SELECT * FROM sessions ORDER BY id`).all()).toEqual(
      before
    );
    for (const table of PART_TABLES) {
      const columns = PART_COLUMNS[table] as readonly string[];
      for (const row of ROWS) {
        const part = db
          .prepare(`SELECT * FROM ${table} WHERE session_id = ?`)
          .get(row.id) as Row | undefined;
        const expected = Object.fromEntries(
          columns.map((c) => [c, row[c] ?? (c === "peer_mirror" ? 0 : null)])
        );
        const hasAny = Object.entries(expected).some(
          ([c, v]) => v !== null && !(c === "peer_mirror" && v === 0)
        );
        if (!hasAny) {
          expect(part, `${table} for ${row.id}`).toBeUndefined();
          continue;
        }
        expect(part, `${table} for ${row.id}`).toEqual({
          session_id: row.id,
          ...expected,
        });
      }
    }
  });

  it("reads back through session_rows as the same rows, in the same shape", () => {
    const db = migrated();
    seed(db);
    runMigrations(db);

    const rows = db.prepare(`SELECT * FROM session_rows ORDER BY id`).all();
    expect(rows).toEqual(
      db.prepare(`SELECT * FROM sessions ORDER BY id`).all()
    );
    expect(Object.keys(rows[0] as object)).toEqual(
      (
        db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
      ).map((c) => c.name)
    );
  });

  it("stamps merged_at and task_ended_at once, in both places", () => {
    const db = migrated();
    runMigrations(db);
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, task_status)
       VALUES ('t', 't', 'x', '/tmp', 'running')`
    ).run();
    db.prepare(
      `UPDATE sessions SET task_status = 'merged' WHERE id = 't'`
    ).run();
    const part = db
      .prepare(
        `SELECT task_status, merged_at FROM session_tasks WHERE session_id = 't'`
      )
      .get() as { task_status: string; merged_at: string };
    expect(part.task_status).toBe("merged");
    expect(part.merged_at).toBeTruthy();
    expect(
      db.prepare(`SELECT merged_at FROM sessions WHERE id = 't'`).get()
    ).toEqual({ merged_at: part.merged_at });
  });

  it("keeps SESSION_ROW_COLUMNS the columns of sessions", () => {
    const db = migrated();
    runMigrations(db);
    expect(SESSION_ROW_COLUMNS).toEqual(
      (
        db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
      ).map((c) => c.name)
    );
    expect(
      (
        db.prepare(`PRAGMA table_info(session_rows)`).all() as {
          name: string;
        }[]
      ).map((c) => c.name)
    ).toEqual(SESSION_ROW_COLUMNS);
  });
});
