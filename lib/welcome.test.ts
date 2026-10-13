import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./db/schema";
import { runMigrations } from "./db/migrations";
import {
  completeWelcome,
  EXISTING_INSTALL,
  readCompletedAt,
  readWelcomeGate,
  welcomeGate,
  type GateInput,
} from "./welcome";

const base: GateInput = {
  completedAt: null,
  sessionCount: 0,
  projectCount: 0,
  demo: false,
  skip: false,
};

describe("welcomeGate", () => {
  it("shows on a fresh install that hasn't finished setup", () => {
    expect(welcomeGate(base)).toEqual({
      show: true,
      fresh: true,
      completedAt: null,
    });
  });

  it.each([
    ["setup finished", { completedAt: "2026-10-13T00:00:00Z" }],
    ["a project of its own", { projectCount: 1 }],
    ["a session", { sessionCount: 1 }],
    ["a demo server", { demo: true }],
    ["AGENTOS_SKIP_WELCOME", { skip: true }],
  ])("stays hidden for %s", (_name, over) => {
    expect(welcomeGate({ ...base, ...over }).show).toBe(false);
  });

  it("reports freshness apart from whether to show", () => {
    expect(welcomeGate({ ...base, completedAt: "x" }).fresh).toBe(true);
    expect(welcomeGate({ ...base, projectCount: 2 }).fresh).toBe(false);
  });
});

function freshDb() {
  const db = new Database(":memory:");
  createSchema(db);
  runMigrations(db);
  return db;
}

describe("completeWelcome", () => {
  it("keeps the first stamp unless told to overwrite", () => {
    const db = freshDb();
    completeWelcome(EXISTING_INSTALL, db);
    completeWelcome("2026-10-13T00:00:00Z", db);
    expect(readCompletedAt(db)).toBe(EXISTING_INSTALL);
    completeWelcome("2026-10-13T00:00:00Z", db, true);
    expect(readCompletedAt(db)).toBe("2026-10-13T00:00:00Z");
  });
});

describe("readWelcomeGate", () => {
  it("opens on an empty database, with only the built-in project", () => {
    const db = freshDb();
    expect(readWelcomeGate(false, db).show).toBe(true);
    expect(readCompletedAt(db)).toBeNull();
  });

  it("marks an install in use as done, and keeps it so once emptied", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO projects (id, name, working_directory) VALUES ('p1', 'App', '/tmp/app')`
    ).run();
    expect(readWelcomeGate(false, db)).toMatchObject({
      show: false,
      fresh: false,
      completedAt: EXISTING_INSTALL,
    });
    db.prepare(`DELETE FROM projects WHERE id = 'p1'`).run();
    expect(readWelcomeGate(false, db).show).toBe(false);
  });
});
