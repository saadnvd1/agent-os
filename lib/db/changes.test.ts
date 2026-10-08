import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  changeWatcher,
  installChangeTriggers,
  movedTables,
  readChangeVersions,
} from "./changes";

describe("change versions", () => {
  it("bumps a table's version on insert, update and delete", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE things (id TEXT PRIMARY KEY, name TEXT)`);
    installChangeTriggers(db, ["things"]);
    const version = () => readChangeVersions(db).get("things") ?? 0;
    db.prepare(`INSERT INTO things VALUES ('a', 'x')`).run();
    expect(version()).toBe(1);
    db.prepare(`UPDATE things SET name = 'y'`).run();
    expect(version()).toBe(2);
    db.prepare(`DELETE FROM things`).run();
    expect(version()).toBe(3);
    // Installing twice (a re-run migration) adds no second trigger.
    installChangeTriggers(db, ["things"]);
    db.prepare(`INSERT INTO things VALUES ('b', 'z')`).run();
    expect(version()).toBe(4);
  });

  it("refuses a table name that isn't a plain identifier", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE things (id TEXT)`);
    expect(() => installChangeTriggers(db, ["x; DROP TABLE y"])).toThrow(
      /bad table name/
    );
    // A name SQL would take as given is refused by the check, not by SQLite.
    expect(() => installChangeTriggers(db, ["Things"])).toThrow(
      /bad table name/
    );
  });

  it("names the tables that moved, a new one included", () => {
    expect(
      movedTables(
        new Map([
          ["a", 1],
          ["b", 2],
        ]),
        new Map([
          ["a", 1],
          ["b", 3],
          ["c", 1],
        ])
      )
    ).toEqual(["b", "c"]);
  });

  it("is installed by the migrations on the sessions table", async () => {
    const { getDb } = await import("@/lib/db");
    const { seedSession } = await import("../orchestrator/testing");
    const { createProject } = await import("../projects");
    const watch = changeWatcher(getDb);
    expect(watch()).toEqual([]);
    const project = createProject({
      name: `p-${randomUUID().slice(0, 6)}`,
      workingDirectory: "/tmp/p",
    });
    seedSession({ projectId: project.id, name: "s" });
    expect(watch().sort()).toEqual(["projects", "sessions"]);
    expect(watch()).toEqual([]);
  });
});

describe("watched tables", () => {
  it("are exactly the tables the migrations put triggers on", async () => {
    const { getDb } = await import("@/lib/db");
    const { WATCHED_TABLES } = await import("./changes");
    const triggered = new Set(
      (
        getDb()
          .prepare(
            `SELECT tbl_name FROM sqlite_master
             WHERE type = 'trigger' AND name LIKE 'change\\_%' ESCAPE '\\'`
          )
          .all() as { tbl_name: string }[]
      ).map((r) => r.tbl_name)
    );
    expect(triggered).toEqual(new Set(WATCHED_TABLES));
  });
});
