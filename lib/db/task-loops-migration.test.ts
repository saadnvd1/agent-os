import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import { tempDir } from "@/lib/test-temp";

describe("migration 20261021T1600_task_loops", () => {
  it("adds the loop tables, allows one running loop per session, and runs twice harmlessly", () => {
    const db = new Database(path.join(tempDir("task-loops-"), "old.db"));
    createSchema(db);
    runMigrations(db);
    runMigrations(db);
    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as { name: string }[]
    ).map((t) => t.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "task_loops",
        "task_loop_criteria",
        "task_loop_cycles",
      ])
    );
    const cols = (
      db.prepare(`PRAGMA table_info(task_loops)`).all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "session_id",
        "state",
        "stop_reason",
        "max_cycles",
      ])
    );
  });
});
