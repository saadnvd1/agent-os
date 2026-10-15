import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createSchema } from "../schema";
import { runMigrations } from "../migrations";
import { readChangeVersions } from "../changes";
import {
  advancePlan,
  fillMissing,
  insertSessionRow,
  isMovedColumn,
  recordPr,
  setPause,
  setPlacement,
  setPlan,
  setPr,
  setTask,
  startTaskClock,
  updateSessionRow,
  writePart,
} from ".";

let db: Database.Database;

const insert = (id: string) =>
  db
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, created_at)
       VALUES (?, ?, ?, '/tmp', '2026-10-01 08:00:00')`
    )
    .run(id, id, `t-${id}`);

const part = (table: string, id: string) =>
  db.prepare(`SELECT * FROM ${table} WHERE session_id = ?`).get(id);
const row = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
  runMigrations(db);
  insert("a");
});

describe("writing a part", () => {
  it("lands in the part table, and sessions has no moved column", () => {
    expect(
      setTask(db, "a", { task_prompt: "do it", task_status: "running" })
    ).toBe(true);
    expect(part("session_tasks", "a")).toMatchObject({
      task_prompt: "do it",
      task_status: "running",
    });
    const own = (
      db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
    ).map((c) => c.name);
    expect(own.filter(isMovedColumn)).toEqual([]);
    expect(row("a")).toMatchObject({ task_status: "running" });
  });

  it("writes only the columns it is given, and null clears one", () => {
    setPr(db, "a", { pr_url: "https://example.test/p/1", pr_number: 1 });
    setPr(db, "a", { pr_status: "open" });
    setPr(db, "a", { pr_url: null });
    expect(part("session_prs", "a")).toMatchObject({
      pr_url: null,
      pr_number: 1,
      pr_status: "open",
    });
  });

  it("is a compare-and-set when given a condition", () => {
    setTask(db, "a", { task_status: "running" });
    expect(
      setTask(db, "a", { task_status: "done" }, { task_status: "moving" })
    ).toBe(false);
    expect(row("a").task_status).toBe("running");
    expect(
      setTask(
        db,
        "a",
        { task_status: "done" },
        { task_status: ["x", "running"] }
      )
    ).toBe(true);
    expect(setTask(db, "a", { task_prompt: "p" }, { priority: null })).toBe(
      true
    );
    expect(row("a")).toMatchObject({ task_status: "done", task_prompt: "p" });
  });

  it("does nothing for a session that is gone and refuses a foreign column", () => {
    expect(setTask(db, "nope", { task_status: "running" })).toBe(false);
    expect(part("session_tasks", "nope")).toBeUndefined();
    expect(() =>
      writePart(db, "session_tasks", "a", { pr_url: "x" } as never)
    ).toThrow(/not a session_tasks column/);
  });

  it("keeps peer_mirror at 0 for a session with no placement row", () => {
    expect(row("a").peer_mirror).toBe(0);
    setPlacement(db, "a", { peer_mirror: 1, held_by_device: "dev" });
    expect(row("a")).toMatchObject({ peer_mirror: 1, held_by_device: "dev" });
  });

  it("stamps merged_at once", () => {
    setTask(db, "a", { task_status: "running" });
    setTask(db, "a", { task_status: "merged" });
    const first = (part("session_tasks", "a") as { merged_at: string })
      .merged_at;
    expect(first).toBeTruthy();
    setTask(db, "a", { task_prompt: "again" });
    expect(
      (part("session_tasks", "a") as { merged_at: string }).merged_at
    ).toBe(first);
  });

  it("stamps merged_at and task_ended_at on a first status write too, and keeps a given one", () => {
    insert("b");
    insert("c");
    insert("d");
    setTask(db, "b", { task_status: "merged" });
    setTask(db, "c", { task_status: "dropped" });
    setTask(db, "d", {
      task_status: "merged",
      merged_at: "2026-10-02 10:00:00",
    });
    expect(row("b").merged_at).toBeTruthy();
    expect(row("c").task_ended_at).toBeTruthy();
    expect(row("c").merged_at).toBeNull();
    expect(row("d").merged_at).toBe("2026-10-02 10:00:00");
    setTask(db, "a", { task_status: "running" });
    setTask(db, "a", { task_status: "done" });
    expect(row("a").task_ended_at).toBeTruthy();
  });

  it("bumps the sessions change topic", () => {
    const before = readChangeVersions(db).get("sessions") ?? 0;
    setPause(db, "a", { pause_state: "paused", pause_id: 3 });
    expect(readChangeVersions(db).get("sessions")).toBeGreaterThan(before);
  });
});

describe("helpers", () => {
  it("recordPr stores the PR and touches the session", () => {
    db.prepare(`UPDATE sessions SET updated_at = '2020-01-01 00:00:00'`).run();
    recordPr(db, "a", {
      url: "https://example.test/p/2",
      number: 2,
      state: "open",
    });
    expect(row("a")).toMatchObject({ pr_number: 2, pr_status: "open" });
    expect(row("a").updated_at).not.toBe("2020-01-01 00:00:00");
  });

  it("startTaskClock sets it once, from created_at", () => {
    startTaskClock(db, "a");
    expect(row("a").task_since).toBe("2026-10-01 08:00:00");
    startTaskClock(db, "a", "2026-10-09 00:00:00");
    expect(row("a").task_since).toBe("2026-10-01 08:00:00");
  });

  it("advancePlan moves a running task's plan one step, once", () => {
    setTask(db, "a", { task_status: "running" });
    setPlan(db, "a", { plan_phase: "planning" });
    expect(advancePlan(db, "a", "planning", "awaiting")).toBe(true);
    expect(advancePlan(db, "a", "planning", "awaiting")).toBe(false);
    setTask(db, "a", { task_status: "dropped" });
    expect(advancePlan(db, "a", "awaiting", "implementing")).toBe(false);
    expect(row("a").plan_phase).toBe("awaiting");
  });

  it("fillMissing copies only onto columns that have no value", () => {
    setPr(db, "a", { pr_url: "https://example.test/keep" });
    fillMissing(db, "a", {
      pr_url: "https://example.test/other",
      pr_number: 9,
      plan_phase: "implementing",
      task_since: null,
    });
    expect(row("a")).toMatchObject({
      pr_url: "https://example.test/keep",
      pr_number: 9,
      plan_phase: "implementing",
      task_since: null,
    });
  });
});

describe("flat rows", () => {
  it("insertSessionRow splits a flat row over sessions and the parts", () => {
    insertSessionRow(db, {
      id: "b",
      name: "b",
      tmux_name: "t-b",
      working_directory: "/tmp",
      priority: "high",
      pr_url: null,
      peer_mirror: 0,
    });
    expect(part("session_tasks", "b")).toMatchObject({ priority: "high" });
    expect(part("session_prs", "b")).toBeUndefined();
    expect(part("session_placement", "b")).toBeUndefined();
    expect(row("b")).toMatchObject({ name: "b", priority: "high" });
  });

  it("updateSessionRow writes each column where it lives, nulls included", () => {
    updateSessionRow(db, "a", { name: "renamed", pr_number: 4 });
    updateSessionRow(db, "a", { pr_number: null, task_status: "moving" });
    expect(row("a")).toMatchObject({
      name: "renamed",
      pr_number: null,
      task_status: "moving",
    });
  });

  it("a deleted session takes its part rows with it", () => {
    setTask(db, "a", { priority: "high" });
    db.prepare(`DELETE FROM sessions WHERE id = 'a'`).run();
    expect(part("session_tasks", "a")).toBeUndefined();
  });
});
