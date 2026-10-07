import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

describe("migration 39 (name_source)", () => {
  it("marks sessions renamed by hand as named by the user", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "name-source-"));
    const db = new Database(path.join(dir, "old.db"));
    createSchema(db);
    runMigrations(db, 38);
    const insert = db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, ?, ?, '/tmp')`
    );
    insert.run("renamed", "my name", "t1");
    insert.run("untouched", "Session 3", "t2");
    db.prepare(
      `INSERT INTO session_names (session_id, name) VALUES ('renamed', 'Session 1')`
    ).run();

    runMigrations(db);

    const source = (id: string) =>
      (
        db.prepare(`SELECT name_source FROM sessions WHERE id = ?`).get(id) as {
          name_source: string;
        }
      ).name_source;
    expect(source("renamed")).toBe("user");
    expect(source("untouched")).toBe("default");
    db.close();
  });
});
