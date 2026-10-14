import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

describe("plan pieces reconcile migration", () => {
  it("adds the feature columns and agent_prs to an older database, once", () => {
    const db = new Database(":memory:");
    createSchema(db);
    runMigrations(db, 85);
    db.prepare(
      `INSERT INTO features (id, workspace_id, name, plan_session_id, plan_text, status)
       VALUES ('f1', 'w', 'Old', 's', 'plan', 'building')`
    ).run();
    runMigrations(db);
    runMigrations(db);
    expect(db.prepare(`SELECT listed, folded FROM features`).get()).toEqual({
      listed: null,
      folded: null,
    });
    db.prepare(
      `INSERT INTO agent_prs (url, session_id, repo, number) VALUES ('u', 's', 'a/b', 1)`
    ).run();
    expect(db.prepare(`SELECT told_at FROM agent_prs`).get()).toEqual({
      told_at: null,
    });
  });
});
