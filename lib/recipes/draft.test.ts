import { describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { makeRecipe, makeSession } from "./test-fixtures";

vi.mock("../session-logs/gather", () => ({
  finalMessage: () => "PR is up.",
}));

const { recipeDraft, recipeNameFrom } = await import("./draft");

function taskFor(projectId: string, prompt: string, name: string) {
  const id = makeSession({
    project_id: projectId,
    task_prompt: prompt,
    name,
  });
  return id;
}

describe("recipeNameFrom", () => {
  it("drops the one-off tail", () => {
    expect(recipeNameFrom("TestFlight build #13")).toBe("TestFlight build");
    expect(recipeNameFrom("Weekly audit 2026-10-11")).toBe("Weekly audit");
    expect(recipeNameFrom('Say "hi" [x]')).toBe("Say hi x");
  });
});

describe("recipeDraft", () => {
  it("prefills from the task and adds the model's brief", async () => {
    const r = makeRecipe();
    const id = taskFor(
      r.project_id,
      "Run scripts/testflight for 1.4.2",
      "TestFlight build #13"
    );
    const out = await recipeDraft(id, async () => ({
      brief: "Run scripts/testflight for the latest version",
      summary: "Cut a build",
    }));
    expect(out).toMatchObject({
      name: "TestFlight build",
      projectId: r.project_id,
      workspaceId: r.workspace_id,
      kind: "task",
      prompt: "Run scripts/testflight for 1.4.2",
      draft: { brief: "Run scripts/testflight for the latest version" },
    });
  });

  it("keeps the original prompt when the model fails, and saves nothing", async () => {
    const r = makeRecipe();
    const id = taskFor(r.project_id, "Do the thing", "Thing");
    const before = (
      db.prepare(`SELECT COUNT(*) AS n FROM recipes`).get() as { n: number }
    ).n;
    const out = await recipeDraft(id, async () => {
      throw new Error("offline");
    });
    expect(out.draft).toBeNull();
    expect(out.prompt).toBe("Do the thing");
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM recipes`).get() as { n: number }).n
    ).toBe(before);
  });

  it("refuses a session outside a project", async () => {
    const id = makeSession({ task_prompt: "x" });
    await expect(recipeDraft(id, async () => ({}))).rejects.toThrow(/project/);
  });
});
