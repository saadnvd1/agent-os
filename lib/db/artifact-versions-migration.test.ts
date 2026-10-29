import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import migration from "./migrations/20261029T1200_artifact_versions";

describe("artifact versions migration", () => {
  it("makes each existing page v1 of itself, and is safe to run twice", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db);
    // A row as an older build wrote it.
    db.prepare(
      `INSERT INTO artifacts (id, session_id, title, path) VALUES ('a', 's', 't', '/p')`
    ).run();
    expect(db.prepare(`SELECT page_id FROM artifacts`).get()).toEqual({
      page_id: null,
    });
    migration.up(db);
    migration.up(db);
    expect(
      db.prepare(`SELECT page_id, version, note FROM artifacts`).get()
    ).toEqual({ page_id: "a", version: 1, note: null });
    expect(() =>
      db
        .prepare(
          `INSERT INTO artifacts (id, session_id, title, path, page_id, version)
           VALUES ('b', 's', 't', '/q', 'a', 1)`
        )
        .run()
    ).toThrow(/UNIQUE/);
  });
});
