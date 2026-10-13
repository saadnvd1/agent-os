import { describe, expect, it } from "vitest";
import { db } from "../db";
import { workspaceWithProject, makeRecipe } from "./test-fixtures";

const { createRecipe, updateRecipe, findRecipe, archiveRecipe, listRecipes } =
  await import("./store");
const { setTimer, getTimer } = await import("./timer");

describe("recipes store", () => {
  it("creates with a first revision and finds by name or id", () => {
    const r = makeRecipe();
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM recipe_revisions WHERE recipe_id = ?`
          )
          .get(r.id) as { n: number }
      ).n
    ).toBe(1);
    expect(findRecipe(r.workspace_id, "testflight BUILD").id).toBe(r.id);
    expect(findRecipe(r.workspace_id, r.id.slice(0, 8)).id).toBe(r.id);
  });

  it("never reaches another workspace's recipe", () => {
    const r = makeRecipe();
    const other = workspaceWithProject();
    expect(() => findRecipe(other.ws.id, r.name)).toThrow(/No recipe/);
  });

  it("validates names, brief size, project and model", () => {
    const { ws, project } = workspaceWithProject();
    const base = {
      workspaceId: ws.id,
      projectId: project.id,
      name: "Ok",
      kind: "task" as const,
      brief: "Do it",
    };
    expect(() => createRecipe({ ...base, name: 'a"b' })).toThrow(/quotes/);
    expect(() => createRecipe({ ...base, name: "" })).toThrow(/name/);
    expect(() => createRecipe({ ...base, brief: "x".repeat(4001) })).toThrow(
      /script/
    );
    expect(() => createRecipe({ ...base, projectId: "nope" })).toThrow(
      /project/
    );
    expect(() => createRecipe({ ...base, maxMinutes: 0 })).toThrow(
      /Time limit/
    );
    createRecipe(base);
    expect(() => createRecipe({ ...base, name: "ok" })).toThrow(/already/);
  });

  it("records a revision only when the brief or settings change", () => {
    const r = makeRecipe();
    const count = () =>
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM recipe_revisions WHERE recipe_id = ?`
          )
          .get(r.id) as { n: number }
      ).n;
    updateRecipe(r.id, { name: "Renamed" });
    expect(count()).toBe(1);
    updateRecipe(r.id, { brief: "New steps" }, "agent-session");
    expect(count()).toBe(2);
    expect(updateRecipe(r.id, {}).updated_by_session_id).toBeNull();
  });

  it("archives the recipe and turns its timer off, keeping history", () => {
    const r = makeRecipe();
    setTimer(r, { cron: "0 9 * * *" });
    expect(getTimer(r.id)?.enabled).toBe(true);
    archiveRecipe(r.id);
    expect(getTimer(r.id)).toBeNull();
    expect(listRecipes(r.workspace_id)).toHaveLength(0);
    expect(
      db.prepare(`SELECT 1 FROM recipes WHERE id = ?`).get(r.id)
    ).toBeTruthy();
  });
});

describe("recipe timers", () => {
  it("refuses more than hourly and bad cron or zone", () => {
    const r = makeRecipe();
    expect(() => setTimer(r, { cron: "*/5 * * * *" })).toThrow(/hour/);
    expect(() => setTimer(r, { cron: "nope" })).toThrow();
    expect(() =>
      setTimer(r, { cron: "0 9 * * *", timezone: "Mars/Base" })
    ).toThrow(/time zone/);
  });

  it("re-arms on a new cron and clears with null", () => {
    const r = makeRecipe();
    const first = setTimer(r, { cron: "0 9 * * *" }, 1000);
    expect(first?.nextRunAt).toBeGreaterThan(1000);
    setTimer(r, { cron: "0 10 * * *", enabled: false }, 5000);
    expect(getTimer(r.id)).toMatchObject({
      cron: "0 10 * * *",
      enabled: false,
    });
    expect(setTimer(r, null)).toBeNull();
    expect(getTimer(r.id)).toBeNull();
  });
});
