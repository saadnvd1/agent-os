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
  isMovedColumn,
  setTask,
} from "./session-parts";
import { tempDir } from "@/lib/test-temp";

const BEFORE = "20261015T1600_plan_waits_for_caller";
const SPLIT = "20261015T1800_split_sessions_tables";

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
    orch_token: ["tok", "not", "real"].join("-"),
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
  const dir = tempDir("split-sessions-");
  const db = new Database(path.join(dir, "old.db"));
  createSchema(db);
  runMigrations(db, upTo ?? BEFORE);
  return db;
}

const columnsOf = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name
  );
const all = (db: Database.Database, from: string) =>
  db.prepare(`SELECT * FROM ${from} ORDER BY id`).all() as Row[];
const backups = () => {
  const dir = path.join(os.homedir(), ".agent-os", "backups");
  return fs.existsSync(dir)
    ? fs.readdirSync(dir).map((f) => path.join(dir, f))
    : [];
};
const clearBackups = () =>
  fs.rmSync(path.join(os.homedir(), ".agent-os", "backups"), {
    recursive: true,
    force: true,
  });

describe("split sessions into focused tables", () => {
  it("backfills every moved value into its table and changes nothing on sessions", () => {
    const db = migrated();
    seed(db);
    const before = all(db, "sessions");

    runMigrations(db, SPLIT);
    runMigrations(db, SPLIT);

    expect(all(db, "sessions")).toEqual(before);
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
});

describe("dropping the moved columns from sessions", () => {
  it("keeps every value of an old-shape database, read back through session_rows", () => {
    clearBackups();
    const db = migrated();
    seed(db);
    const before = all(db, "sessions");
    const oldColumns = columnsOf(db, "sessions");

    runMigrations(db);
    runMigrations(db);

    expect(columnsOf(db, "sessions").filter(isMovedColumn)).toEqual([]);
    const after = all(db, "session_rows");
    expect(after).toEqual(before);
    expect(Object.keys(after[0])).toEqual(oldColumns);
    // Every moved column carries a real value in some row.
    const held = new Set(
      before.flatMap((r) =>
        Object.keys(r).filter(
          (c) => isMovedColumn(c) && r[c] !== null && r[c] !== 0
        )
      )
    );
    expect([...held].sort()).toEqual(oldColumns.filter(isMovedColumn).sort());
  });

  it("carries a value only sessions still holds, and a newer one in a table wins", () => {
    const db = migrated();
    seed(db);
    runMigrations(db, SPLIT);
    const before = all(db, "sessions");
    // Drift the tables from sessions, as a lost trigger or a bad write would.
    db.prepare(`DELETE FROM session_prs WHERE session_id = 'merged'`).run();
    db.prepare(
      `UPDATE session_tasks SET task_brief = NULL, lh_card_list = NULL WHERE session_id = 'running'`
    ).run();
    db.prepare(
      `UPDATE session_placement SET peer_mirror = 0 WHERE session_id = 'mirror'`
    ).run();
    setTask(db, "paused", { task_prompt: "Refactor the loader, newer." });

    runMigrations(db);

    const expected = before.map((r) =>
      r.id === "paused"
        ? { ...r, task_prompt: "Refactor the loader, newer." }
        : r
    );
    expect(all(db, "session_rows")).toEqual(expected);
  });

  it("writes a full copy of the database first", () => {
    clearBackups();
    const db = migrated();
    seed(db);
    const before = all(db, "sessions");
    runMigrations(db);

    const files = backups();
    expect(files).toHaveLength(1);
    expect(path.basename(files[0])).toMatch(
      /^agent-os-\d{8}T\d{6}-\d+-[0-9a-f]{6}-drop-moved-session-columns\.db$/
    );
    const copy = new Database(files[0], { readonly: true });
    expect(all(copy, "sessions")).toEqual(before);
    copy.close();
  });

  it("refuses to drop anything when the copy cannot be written", () => {
    const db = migrated();
    seed(db);
    const home = process.env.HOME;
    const blocked = tempDir("no-backups-");
    fs.mkdirSync(path.join(blocked, ".agent-os"));
    fs.writeFileSync(path.join(blocked, ".agent-os", "backups"), "a file");
    process.env.HOME = blocked;
    try {
      expect(() => runMigrations(db)).toThrow(/Backup before .* failed/);
    } finally {
      process.env.HOME = home;
    }
    expect(columnsOf(db, "sessions")).toContain("task_status");
    expect(
      db
        .prepare(`SELECT 1 FROM _migrations WHERE key LIKE '%drop_moved%'`)
        .get()
    ).toBeUndefined();
  });

  it("takes no copy of an empty database", () => {
    clearBackups();
    const db = migrated();
    runMigrations(db);
    expect(backups()).toEqual([]);
    expect(columnsOf(db, "sessions").filter(isMovedColumn)).toEqual([]);
  });

  it("keeps session_rows in the shape of SESSION_ROW_COLUMNS", () => {
    const db = migrated();
    runMigrations(db);
    expect(columnsOf(db, "session_rows")).toEqual(SESSION_ROW_COLUMNS);
    expect(columnsOf(db, "sessions")).toEqual(
      SESSION_ROW_COLUMNS.filter((c) => !isMovedColumn(c))
    );
  });
});
