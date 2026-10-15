import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

const names = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name
  );

describe("recipes migration", () => {
  it("adds the tables and columns, and is safe to run twice", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db, 79);
    runMigrations(db);
    runMigrations(db);
    for (const t of ["recipes", "recipe_runs", "features", "feature_pieces"])
      expect(names(db, t).length).toBeGreaterThan(3);
    expect(names(db, "schedules")).toContain("recipe_id");
    expect(names(db, "session_rows")).toContain("plan_edits");
  });

  it("lets a recipe have one live run only", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db);
    const add = (seq: number, status: string) =>
      db
        .prepare(
          `INSERT INTO recipe_runs (recipe_id, seq, trigger, prompt, status) VALUES ('r', ?, 'manual', 'p', ?)`
        )
        .run(seq, status);
    add(1, "running");
    expect(() => add(2, "starting")).toThrow(/UNIQUE/);
    db.prepare(`UPDATE recipe_runs SET status = 'succeeded'`).run();
    expect(() => add(2, "starting")).not.toThrow();
  });

  it("watches the new tables for live updates", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db);
    db.prepare(
      `INSERT INTO recipes (id, workspace_id, project_id, name, kind, brief) VALUES ('a','w','p','n','task','b')`
    ).run();
    const row = db
      .prepare(`SELECT version FROM change_versions WHERE topic = 'recipes'`)
      .get() as { version: number };
    expect(row.version).toBe(1);
  });
});
