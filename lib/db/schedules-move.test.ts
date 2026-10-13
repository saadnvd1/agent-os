import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import { moveSchedulesToRecipes, revertSchedulesMove } from "./schedules-move";

function seeded() {
  const db = new Database(":memory:");
  createSchema(db);
  runMigrations(db, 80);
  const schedule = (
    id: string,
    kind: string,
    extra: { archived?: boolean; runAt?: number; name?: string } = {}
  ) =>
    db
      .prepare(
        `INSERT INTO schedules (id, workspace_id, project_id, name, cron, timezone, prompt, kind, created_by_session_id, armed_at, archived_at, run_at)
         VALUES (?, 'w', 'p', ?, '0 9 * * *', 'UTC', ?, ?, 'creator', 1, ?, ?)`
      )
      .run(
        id,
        extra.name ?? `${id} name`,
        `${id} prompt`,
        kind,
        extra.archived ? "2026-10-01 00:00:00" : null,
        extra.runAt ?? null
      );
  const session = (id: string, taskStatus: string | null, pr?: number) =>
    db
      .prepare(
        `INSERT INTO sessions (id, name, tmux_name, working_directory, task_status, pr_number) VALUES (?, 's', ?, '/tmp', ?, ?)`
      )
      .run(id, `claude-${id}`, taskStatus, pr ?? null);
  let n = 0;
  const run = (schedule: string, trigger: string, sessionId: string | null) =>
    db
      .prepare(
        `INSERT INTO schedule_runs (schedule_id, slot, slot_at, trigger, outcome, session_id) VALUES (?, ?, 0, ?, 'started', ?)`
      )
      .run(schedule, `slot${n++}`, trigger, sessionId);

  schedule("task1", "task");
  schedule("sess1", "session");
  schedule("orch", "orchestrator");
  schedule("msg", "message");
  schedule("oldtask", "task", { archived: true });
  schedule("once", "task", { runAt: 5 });
  session("m", "merged", 7);
  session("x", "dropped");
  session("d", "done");
  session("live", null);
  session("chat", null);
  run("task1", "schedule", "m");
  run("task1", "catch-up", "x");
  run("task1", "manual", "d");
  run("task1", "schedule", null);
  run("task1", "schedule", "live");
  run("sess1", "schedule", "chat");
  run("sess1", "schedule", "chat-gone");
  run("oldtask", "schedule", "m");
  return db;
}

const kinds = (db: Database.Database) =>
  Object.fromEntries(
    (
      db.prepare(`SELECT id, kind FROM schedules`).all() as {
        id: string;
        kind: string;
      }[]
    ).map((s) => [s.id, s.kind])
  );

describe("migration 81: schedules into recipes", () => {
  it("moves live task and session schedules, and nothing else", () => {
    const db = seeded();
    runMigrations(db);
    expect(kinds(db)).toEqual({
      task1: "recipe",
      sess1: "recipe",
      orch: "orchestrator",
      msg: "message",
      oldtask: "task",
      once: "task",
    });
    const t = db
      .prepare(`SELECT * FROM schedules WHERE id = 'task1'`)
      .get() as {
      recipe_id: string;
      migrated_from_kind: string;
    };
    expect(t.migrated_from_kind).toBe("task");
    expect(db.prepare(`SELECT * FROM recipes`).all()).toHaveLength(2);
    expect(
      db.prepare(`SELECT * FROM recipes WHERE id = ?`).get(t.recipe_id)
    ).toMatchObject({
      workspace_id: "w",
      project_id: "p",
      name: "task1 name",
      kind: "task",
      brief: "task1 prompt",
      view: "chat",
      model: null,
      created_by_session_id: "creator",
    });
    expect(
      db.prepare(`SELECT count(*) AS n FROM recipe_revisions`).get()
    ).toEqual({ n: 2 });
  });

  it("backfills runs in order, with the trigger and status mapped", () => {
    const db = seeded();
    runMigrations(db);
    const rows = db
      .prepare(
        `SELECT r.seq, r.trigger, r.status, r.session_id, r.prompt, r.pr_number, r.cost_usd
           FROM recipe_runs r JOIN recipes c ON c.id = r.recipe_id WHERE c.name = 'task1 name' ORDER BY seq`
      )
      .all();
    expect(rows).toEqual([
      {
        seq: 1,
        trigger: "timer",
        status: "succeeded",
        session_id: "m",
        prompt: "task1 prompt",
        pr_number: 7,
        cost_usd: null,
      },
      {
        seq: 2,
        trigger: "catch-up",
        status: "failed",
        session_id: "x",
        prompt: "task1 prompt",
        pr_number: null,
        cost_usd: null,
      },
      {
        seq: 3,
        trigger: "manual",
        status: "succeeded",
        session_id: "d",
        prompt: "task1 prompt",
        pr_number: null,
        cost_usd: null,
      },
      {
        seq: 4,
        trigger: "timer",
        status: "running",
        session_id: "live",
        prompt: "task1 prompt",
        pr_number: null,
        cost_usd: null,
      },
    ]);
    // A run with no session wasn't a run; an unfinished one before the
    // latest can't also be live.
    const sess = db
      .prepare(
        `SELECT r.seq, r.status FROM recipe_runs r JOIN recipes c ON c.id = r.recipe_id WHERE c.name = 'sess1 name' ORDER BY seq`
      )
      .all();
    expect(sess).toEqual([
      { seq: 1, status: "cancelled" },
      { seq: 2, status: "running" },
    ]);
    expect(db.prepare(`SELECT count(*) AS n FROM recipe_runs`).get()).toEqual({
      n: 6,
    });
  });

  it("is idempotent", () => {
    const db = seeded();
    runMigrations(db);
    const before = db.prepare(`SELECT count(*) AS n FROM recipe_runs`).get();
    expect(moveSchedulesToRecipes(db)).toEqual({ schedules: 0, runs: 0 });
    runMigrations(db);
    expect(db.prepare(`SELECT count(*) AS n FROM recipes`).get()).toEqual({
      n: 2,
    });
    expect(db.prepare(`SELECT count(*) AS n FROM recipe_runs`).get()).toEqual(
      before
    );
  });

  it("renames a recipe whose name is taken", () => {
    const db = seeded();
    db.prepare(
      `INSERT INTO recipes (id, workspace_id, project_id, name, kind, brief) VALUES ('r', 'w', 'p', 'TASK1 NAME', 'task', 'b')`
    ).run();
    runMigrations(db);
    const names = (
      db.prepare(`SELECT name FROM recipes ORDER BY name`).all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(names).toContain("task1 name (schedule)");
  });

  it("reverses: old kinds back, the recipes it made gone", () => {
    const db = seeded();
    const schedules = db.prepare(`SELECT * FROM schedules ORDER BY id`).all();
    const scheduleRuns = db
      .prepare(`SELECT * FROM schedule_runs ORDER BY id`)
      .all();
    runMigrations(db);
    db.prepare(
      `UPDATE recipes SET brief = 'edited' WHERE name = 'task1 name'`
    ).run();
    db.prepare(
      `INSERT INTO recipes (id, workspace_id, project_id, name, kind, brief) VALUES ('mine', 'w', 'p', 'mine', 'task', 'b')`
    ).run();
    expect(revertSchedulesMove(db)).toEqual({ schedules: 2 });
    expect(kinds(db)).toEqual({
      task1: "task",
      sess1: "session",
      orch: "orchestrator",
      msg: "message",
      oldtask: "task",
      once: "task",
    });
    const back = db
      .prepare(`SELECT * FROM schedules WHERE id = 'task1'`)
      .get() as Record<string, unknown>;
    expect(back).toMatchObject({
      recipe_id: null,
      migrated_from_kind: null,
      prompt: "edited",
    });
    // Only the move's recipes go; one made since stays.
    expect(db.prepare(`SELECT id FROM recipes`).all()).toEqual([
      { id: "mine" },
    ]);
    expect(db.prepare(`SELECT count(*) AS n FROM recipe_runs`).get()).toEqual({
      n: 0,
    });
    expect(
      db.prepare(`SELECT count(*) AS n FROM recipe_revisions`).get()
    ).toEqual({ n: 0 });
    expect(db.prepare(`SELECT * FROM schedule_runs ORDER BY id`).all()).toEqual(
      scheduleRuns
    );
    expect(schedules).toHaveLength(6);
    expect(revertSchedulesMove(db)).toEqual({ schedules: 0 });
  });
});
