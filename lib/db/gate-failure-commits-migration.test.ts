import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import { tempDir } from "@/lib/test-temp";

describe("migration 59 (gate_failure_commits)", () => {
  it("carries each counted head over, so judging it again after the upgrade isn't a second failure", () => {
    const dir = tempDir("gate-commits-");
    const db = new Database(path.join(dir, "old.db"));
    createSchema(db);
    runMigrations(db, 58);
    const X = "x".repeat(40);
    const insert = db.prepare(
      `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count, last_reason, last_sha)
       VALUES (?, ?, 'w', 1, 'why', ?)`
    );
    insert.run("t", "ci", X);
    insert.run("t", "review", null);

    runMigrations(db);

    const commits = () =>
      db
        .prepare(
          `SELECT session_id, gate, sha FROM orchestrator_gate_failure_commits`
        )
        .all();
    expect(commits()).toEqual([{ session_id: "t", gate: "ci", sha: X }]);
    expect(
      db
        .prepare(
          `INSERT OR IGNORE INTO orchestrator_gate_failure_commits (session_id, gate, sha, workspace_id) VALUES ('t', 'ci', ?, 'w')`
        )
        .run(X).changes
    ).toBe(0);
    db.prepare(
      `DELETE FROM orchestrator_gate_failures WHERE gate = 'ci'`
    ).run();
    expect(commits()).toEqual([]);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
