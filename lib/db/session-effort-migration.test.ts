import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import { tempDir } from "@/lib/test-temp";

describe("session_effort migration", () => {
  it("adds nullable effort to sessions, the view and the task queue", () => {
    const db = new Database(path.join(tempDir("effort-"), "old.db"));
    createSchema(db);
    runMigrations(db, 89);
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory)
       VALUES ('a', 'a', 't', '/tmp')`
    ).run();

    runMigrations(db);
    runMigrations(db);

    expect(db.prepare(`SELECT effort FROM sessions`).get()).toEqual({
      effort: null,
    });
    expect(db.prepare(`SELECT effort FROM session_rows`).get()).toEqual({
      effort: null,
    });
    db.prepare(`UPDATE sessions SET effort = 'high' WHERE id = 'a'`).run();
    expect(
      db.prepare(`SELECT effort FROM session_rows WHERE id = 'a'`).get()
    ).toEqual({ effort: "high" });
    expect(
      (db.prepare(`PRAGMA table_info(task_queue)`).all() as { name: string }[])
        .map((c) => c.name)
        .includes("effort")
    ).toBe(true);
  });
});
