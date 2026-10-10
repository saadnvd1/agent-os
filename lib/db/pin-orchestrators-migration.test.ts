import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

describe("migration 47 (pin_orchestrators)", () => {
  it("pins existing orchestrators and nothing else", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pin-orch-"));
    const db = new Database(path.join(dir, "old.db"));
    createSchema(db);
    runMigrations(db, 46);
    const insert = db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, role, workspace_id)
       VALUES (?, ?, ?, '/tmp', ?, ?)`
    );
    insert.run("orch", "o", "t1", "orchestrator", "w1");
    insert.run("task", "t", "t2", null, "w1");

    runMigrations(db);

    const pinned = (id: string) =>
      (
        db.prepare(`SELECT pinned FROM sessions WHERE id = ?`).get(id) as {
          pinned: number;
        }
      ).pinned;
    expect(pinned("orch")).toBe(1);
    expect(pinned("task")).toBe(0);
    db.close();
  });
});
