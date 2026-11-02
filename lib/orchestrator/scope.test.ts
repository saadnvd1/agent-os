import { describe, expect, it, vi } from "vitest";
import { checkScope, isTaskStatePath } from "./scope";
import { seedSession, seedWorkspace } from "./testing";
import { db } from "../db";
import type { Session } from "../db";

describe("the scope rule on .agentos/", () => {
  it("matches the folder and nothing beside it", () => {
    expect(isTaskStatePath(".agentos/plan.md")).toBe(true);
    expect(isTaskStatePath(".agentos")).toBe(true);
    expect(isTaskStatePath("docs/.agentos/x")).toBe(false);
    expect(isTaskStatePath(".agentos-notes.md")).toBe(false);
  });

  it("blocks a diff touching it without asking the model", async () => {
    const { app, workspace } = seedWorkspace();
    const id = seedSession({ projectId: app.id, name: "t", task: true });
    const task = db
      .prepare(`SELECT * FROM session_rows WHERE id = ?`)
      .get(id) as Session;
    const claude = vi.fn();
    const row = await checkScope({
      workspaceId: workspace.id,
      task,
      sha: "abc123",
      files: [
        { path: "src/a.ts", status: "M" },
        { path: ".agentos/plan.md", status: "A" },
      ] as never,
      parts: ["diff"],
      claude,
    });
    expect(row.status).toBe("block");
    expect(row.detail).toContain(".agentos/plan.md");
    expect(claude).not.toHaveBeenCalled();
  });
});
