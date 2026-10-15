import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createSchema } from "../schema";
import { runMigrations } from "../migrations";
import { readChangeVersions } from "../changes";
import {
  advancePlan,
  fillMissing,
  recordPr,
  setPause,
  setPlacement,
  setPlan,
  setPr,
  setTask,
  startTaskClock,
  writePart,
} from ".";

let db: Database.Database;

const insert = (id: string, extra = "") =>
  db
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, created_at${extra ? ", " + extra.split("=")[0] : ""})
       VALUES (?, ?, ?, '/tmp', '2026-10-01 08:00:00'${extra ? ", " + extra.split("=")[1] : ""})`
    )
    .run(id, id, `t-${id}`);

const part = (table: string, id: string) =>
  db.prepare(`SELECT * FROM ${table} WHERE session_id = ?`).get(id);
const legacy = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;
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
  it("lands in the part table and mirrors onto the legacy columns", () => {
    expect(
      setTask(db, "a", { task_prompt: "do it", task_status: "running" })
    ).toBe(true);
    expect(part("session_tasks", "a")).toMatchObject({
      task_prompt: "do it",
      task_status: "running",
    });
    expect(legacy("a")).toMatchObject({
      task_prompt: "do it",
      task_status: "running",
    });
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

  it("stamps merged_at once, the same in both places", () => {
    setTask(db, "a", { task_status: "running" });
    setTask(db, "a", { task_status: "merged" });
    const first = (part("session_tasks", "a") as { merged_at: string })
      .merged_at;
    expect(first).toBeTruthy();
    expect(legacy("a").merged_at).toBe(first);
    setTask(db, "a", { task_prompt: "again" });
    expect(
      (part("session_tasks", "a") as { merged_at: string }).merged_at
    ).toBe(first);
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

describe("a write straight to a legacy column (an older build, a chat worker)", () => {
  it("reaches the part table", () => {
    db.prepare(
      `UPDATE sessions SET task_status = 'moving', pr_number = 4 WHERE id = 'a'`
    ).run();
    expect(part("session_tasks", "a")).toMatchObject({ task_status: "moving" });
    expect(part("session_prs", "a")).toMatchObject({ pr_number: 4 });
  });

  it("does not undo a newer value in the part table", () => {
    setPlan(db, "a", { plan_phase: "awaiting", plan_note: "n" });
    db.prepare(`UPDATE sessions SET plan_only = 1 WHERE id = 'a'`).run();
    expect(part("session_plans", "a")).toMatchObject({
      plan_phase: "awaiting",
      plan_note: "n",
      plan_only: 1,
    });
  });

  it("an insert with moved values fills the part tables, and a delete removes them", () => {
    insert("b", "priority='high'");
    expect(part("session_tasks", "b")).toMatchObject({ priority: "high" });
    expect(part("session_prs", "b")).toBeUndefined();
    db.prepare(`DELETE FROM sessions WHERE id = 'b'`).run();
    expect(part("session_tasks", "b")).toBeUndefined();
  });
});
