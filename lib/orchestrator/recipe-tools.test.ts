import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { seedWorkspace } from "./testing";

const started: Record<string, unknown>[] = [];
vi.mock("@/lib/sessions/launch", async (orig) => ({
  ...(await orig<typeof import("@/lib/sessions/launch")>()),
  launchSession: async (o: { id: string }) => {
    started.push(o);
    return { session: { id: o.id } };
  },
}));

const { ensureOrchestrator } = await import("./home");
const { runTool } = await import("./serve");
const { setPaused } = await import("./pause");
const { buildDigest } = await import("./digest");
const { TOOL_SHAPES, parseArgs } = await import("./tool-schemas");
const { db } = await import("@/lib/db");

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-recipes-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

function setup() {
  const t = seedWorkspace();
  const orch = ensureOrchestrator(t.workspace.id);
  return { ...t, orch, w: t.workspace.id, project: t.app.name };
}

const save = (
  t: ReturnType<typeof setup>,
  over: Record<string, unknown> = {}
) =>
  runTool(t.w, "recipe_save", {
    name: "TestFlight build",
    project: t.project,
    kind: "session",
    brief: "Run scripts/testflight and judge the result.",
    ...over,
  });

describe("recipe tools", () => {
  it("saves, lists and shows a recipe, written by the orchestrator", async () => {
    const t = setup();
    expect(await save(t)).toMatch(/Saved recipe "TestFlight build"/);
    expect(await runTool(t.w, "recipes", {})).toContain(
      '"TestFlight build" (session; never run)'
    );
    const full = await runTool(t.w, "recipes", { name: "testflight build" });
    expect(full).toContain("Run scripts/testflight");
    expect(full).toContain("No timer.");
    const row = db
      .prepare(
        `SELECT created_by_session_id FROM recipes WHERE workspace_id = ?`
      )
      .get(t.w) as { created_by_session_id: string };
    expect(row.created_by_session_id).toBe(t.orch.id);
  });

  it("run_recipe starts a run as the orchestrator and refuses a second while it goes", async () => {
    const t = setup();
    await save(t);
    started.length = 0;
    const said = await runTool(t.w, "run_recipe", {
      name: "TestFlight build",
      note: "Includes #87",
    });
    expect(said).toMatch(/Started run #1/);
    expect(started[0]).toMatchObject({ startedBy: t.orch.id });
    expect(String(started[0].prompt)).toContain("Includes #87");
    const again = await runTool(t.w, "run_recipe", {
      name: "TestFlight build",
    });
    expect(again).toMatch(/already has run #1 going/);
    expect(started).toHaveLength(1);
  });

  it("run_recipe, recipe_save and recipe_update are refused while paused", async () => {
    const t = setup();
    await save(t);
    setPaused(t.w, true);
    for (const [tool, args] of [
      ["run_recipe", { name: "TestFlight build" }],
      [
        "recipe_save",
        { name: "X", project: t.project, kind: "task", brief: "b" },
      ],
      ["recipe_update", { name: "TestFlight build", brief: "new" }],
    ] as const)
      await expect(runTool(t.w, tool, args)).rejects.toThrow(/Paused/);
    // Reading still works.
    expect(await runTool(t.w, "recipes", {})).toContain("TestFlight build");
  });

  it("only reaches its own workspace's recipes and projects", async () => {
    const a = setup();
    const b = setup();
    await save(a);
    await expect(
      runTool(b.w, "run_recipe", { name: "TestFlight build" })
    ).rejects.toThrow(/No recipe/);
    await expect(save(b, { project: a.project })).rejects.toThrow(/No project/);
  });

  it("has no way to set a timer or approve anything", () => {
    expect(Object.keys(TOOL_SHAPES.recipe_update)).not.toContain("timer");
    expect(Object.keys(TOOL_SHAPES.recipe_update)).not.toContain("cron");
    expect(() =>
      parseArgs("recipe_update", { name: "x", cron: "0 9 * * *" })
    ).toThrow(/Bad arguments/);
    expect(() => parseArgs("run_recipe", { name: "x", approve: true })).toThrow(
      /Bad arguments/
    );
  });

  it("recipe_update keeps a revision and refuses a brief that is too long", async () => {
    const t = setup();
    await save(t);
    await runTool(t.w, "recipe_update", {
      name: "TestFlight build",
      brief: "Steps v2",
    });
    const n = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM recipe_revisions r JOIN recipes c ON c.id = r.recipe_id WHERE c.workspace_id = ?`
        )
        .get(t.w) as { n: number }
    ).n;
    expect(n).toBe(2);
    await expect(
      runTool(t.w, "recipe_update", {
        name: "TestFlight build",
        brief: "x".repeat(4001),
      })
    ).rejects.toThrow(/Bad arguments/);
  });

  it("lists recipes in the digest before external sessions and schedules", async () => {
    const t = setup();
    await save(t);
    const digest = buildDigest(t.w);
    expect(digest).toContain("### Recipes");
    expect(digest).toContain('"TestFlight build" (session; never run)');
    const order = ["### Recipes", "### Queue", "### Schedules"].map((h) =>
      digest.indexOf(h)
    );
    expect(order[0]).toBeGreaterThan(-1);
    for (const i of order.slice(1))
      if (i !== -1) expect(order[0]).toBeLessThan(i);
  });
});
