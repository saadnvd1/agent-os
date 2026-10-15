import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

describe("task_scheduling migration", () => {
  it("adds the columns to a database one migration behind, twice, and keeps rows", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db, "20261014T0000");
    db.prepare(
      `INSERT INTO projects (id, name, working_directory) VALUES ('p', 'P', '/tmp/p')`
    ).run();
    db.prepare(
      `INSERT INTO task_queue (id, project_id, prompt, position) VALUES ('q1', 'p', 'x', 1), ('q2', 'p', 'y', 2)`
    ).run();
    runMigrations(db);
    runMigrations(db);
    const q = db
      .prepare(
        `SELECT id, priority, after_any_used FROM task_queue ORDER BY id`
      )
      .all();
    expect(q).toEqual([
      { id: "q1", priority: "normal", after_any_used: null },
      { id: "q2", priority: "normal", after_any_used: null },
    ]);
    const cols = (t: string) =>
      (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(
        (c) => c.name
      );
    expect(cols("session_rows")).toEqual(
      expect.arrayContaining([
        "priority",
        "pause_state",
        "paused_until",
        "pause_id",
      ])
    );
    expect(cols("bus_messages")).toContain("held_pause_id");
    expect(cols("projects")).toEqual(
      expect.arrayContaining(["machine_needs", "machine_needs_source"])
    );
    expect(cols("task_pauses")).toContain("until_at");
  });

  it("refuses a finish being used by two waiters", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, working_directory) VALUES ('p', 'P', '/tmp/p')`
    ).run();
    const ins = db.prepare(
      `INSERT INTO task_queue (id, project_id, prompt, position, after_any_used) VALUES (?, 'p', 'x', ?, ?)`
    );
    ins.run("a", 1, "r3");
    ins.run("b", 2, null);
    ins.run("c", 3, null);
    expect(() => ins.run("d", 4, "r3")).toThrow(/UNIQUE/);
  });
});
