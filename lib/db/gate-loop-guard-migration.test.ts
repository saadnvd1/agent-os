import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import { tempDir } from "@/lib/test-temp";

describe("migration 20261015T1733_gate_loop_guard", () => {
  it("starts each recorded gate's streak at its count, and runs twice harmlessly", () => {
    const dir = tempDir("gate-loop-guard-");
    const db = new Database(path.join(dir, "old.db"));
    createSchema(db);
    runMigrations(db, "20261015T1600_plan_waits_for_caller");
    db.prepare(
      `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count, last_reason, last_sha)
       VALUES ('t', 'ci', 'w', 3, 'why', ?)`
    ).run("x".repeat(40));

    runMigrations(db);
    const row = () =>
      db
        .prepare(
          `SELECT count, streak, last_signature, repeated, escalated_why FROM orchestrator_gate_failures`
        )
        .get();
    expect(row()).toEqual({
      count: 3,
      streak: 3,
      last_signature: null,
      repeated: 0,
      escalated_why: null,
    });
    expect(
      db
        .prepare(`PRAGMA table_info(orchestrator_gate_failure_commits)`)
        .all()
        .map((c) => (c as { name: string }).name)
    ).toContain("signature");

    db.prepare(`UPDATE orchestrator_gate_failures SET streak = 1`).run();
    db.prepare(
      `DELETE FROM _migrations WHERE key = '20261015T1733_gate_loop_guard'`
    ).run();
    runMigrations(db);
    expect(row()).toMatchObject({ streak: 1 });
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
