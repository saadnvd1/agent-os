import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

const flag = (db: Database.Database) =>
  (
    db
      .prepare(`SELECT value FROM settings WHERE key = 'welcome.completed_at'`)
      .get() as { value: string } | undefined
  )?.value;

function before() {
  const db = new Database(":memory:");
  createSchema(db);
  runMigrations(db, 75);
  return db;
}

describe("welcome backfill migration", () => {
  it("marks an install with a project of its own as already set up", () => {
    const db = before();
    db.prepare(
      `INSERT INTO projects (id, name, working_directory) VALUES ('p1', 'App', '/tmp/app')`
    ).run();
    runMigrations(db);
    expect(flag(db)).toBe("existing-install");
    runMigrations(db);
    expect(flag(db)).toBe("existing-install");
  });

  it("marks an install with a session, even in Uncategorized", () => {
    const db = before();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id)
       VALUES ('s1', 'x', 'claude-s1', '/tmp', 'uncategorized')`
    ).run();
    runMigrations(db);
    expect(flag(db)).toBe("existing-install");
  });

  it("leaves a fresh install for the welcome", () => {
    const db = before();
    runMigrations(db);
    expect(flag(db)).toBeUndefined();
  });
});
