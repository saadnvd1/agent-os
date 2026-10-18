import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import { tempDir } from "@/lib/test-temp";

describe("migration 82 (session_shelf_times)", () => {
  it("adds the columns and starts active_at at updated_at", () => {
    const dir = tempDir("shelf-times-");
    const db = new Database(path.join(dir, "old.db"));
    createSchema(db);
    runMigrations(db, 81);
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, updated_at)
       VALUES ('a', 'a', 't', '/tmp', '2026-10-01 10:00:00')`
    ).run();

    runMigrations(db);
    runMigrations(db);

    expect(
      db.prepare(`SELECT * FROM sessions WHERE id = 'a'`).get()
    ).toMatchObject({
      active_at: "2026-10-01 10:00:00",
      settled_at: null,
      snoozed_until: null,
      snoozed_at: null,
    });
  });
});
