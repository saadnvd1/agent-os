import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { moveSchedulesToRecipes } from "../db/schedules-move";
import { workspaceWithProject } from "../recipes/test-fixtures";

const started: string[] = [];
vi.mock("../sessions/launch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sessions/launch")>()),
  launchSession: async (opts: { id: string; prompt: string }) => {
    started.push(opts.prompt);
    return { session: { id: opts.id } };
  },
}));

const { realDeps } = await import("./start");
const { tick } = await import("./scheduler");
const { setPaused } = await import("../orchestrator/pause");
const { listSchedules } = await import("./store");
const { listScheduleViews } = await import("./index");

const HOUR = Date.parse("2026-10-13T15:00:00Z");

function legacy(kind: "task" | "session") {
  const { ws, project } = workspaceWithProject();
  const id = `legacy-${kind}-${ws.id}`;
  db.prepare(
    `INSERT INTO schedules (id, workspace_id, project_id, name, cron, timezone, prompt, kind, armed_at)
     VALUES (?, ?, ?, 'Nightly', '0 * * * *', 'UTC', 'Do the nightly thing', ?, ?)`
  ).run(id, ws.id, project.id, kind, HOUR - 3_600_000);
  return { id, ws };
}

describe("a moved schedule", () => {
  beforeEach(() => {
    started.length = 0;
  });

  it("starts a recipe run on its next tick, and shows as a recipe timer", async () => {
    const { id, ws } = legacy("session");
    moveSchedulesToRecipes(db);
    const moved = listSchedules(ws.id).find((s) => s.id === id)!;
    expect(moved.kind).toBe("recipe");
    expect(listScheduleViews(ws.id).some((s) => s.id === id)).toBe(false);

    const results = await tick(realDeps, HOUR + 5_000, 0);
    const mine = results.find((r) => r.runId && r.sessionId !== undefined)!;
    expect(mine.outcome).toBe("started");
    const run = db
      .prepare(
        `SELECT * FROM recipe_runs WHERE recipe_id = ? AND trigger = 'timer'`
      )
      .get(moved.recipe_id) as {
      status: string;
      prompt: string;
      session_id: string;
    };
    expect(run.status).toBe("running");
    expect(run.prompt).toContain("Do the nightly thing");
    expect(started).toHaveLength(1);
  });

  it("is held by the brakes like any recipe run", async () => {
    const { id, ws } = legacy("task");
    moveSchedulesToRecipes(db);
    const recipeId = listSchedules(ws.id).find((s) => s.id === id)!.recipe_id;
    setPaused(ws.id, true);
    await tick(realDeps, HOUR + 5_000, 0);
    expect(
      db
        .prepare(`SELECT count(*) AS n FROM recipe_runs WHERE recipe_id = ?`)
        .get(recipeId)
    ).toEqual({ n: 0 });
    expect(
      db
        .prepare(`SELECT outcome FROM schedule_runs WHERE schedule_id = ?`)
        .get(id)
    ).toEqual({ outcome: "skipped" });
  });
});
