import { describe, expect, it } from "vitest";
import { db, updateSessionRow } from "../db";
import { amendBrief } from "../orchestrator/amendments";
import { seedSession, seedWorkspace } from "../orchestrator/testing";
import { compactContext } from "./compact-context";
import { saveItem } from "./store";

describe("compactContext", () => {
  const taskWith = (prompt: string) => {
    const ws = seedWorkspace();
    const id = seedSession({ projectId: ws.app.id, name: "t", task: true });
    updateSessionRow(db, id, { task_prompt: prompt });
    return { ws, id };
  };

  it("gives a task its brief, scope changes and edited files back", async () => {
    const { ws, id } = taskWith("Build the export button");
    amendBrief(ws.workspace.id, id, "Make it CSV only");
    saveItem(id, {
      id: "t1",
      createdAt: 1,
      kind: "tool",
      name: "Edit",
      title: "Edit",
      input: { file_path: "/w/export.ts" },
      status: "done",
    });
    saveItem(id, {
      id: "todo1",
      createdAt: 2,
      kind: "todos",
      todos: [{ text: "wire the button", status: "in_progress" }],
    } as never);
    const note = await compactContext(id);
    expect(note).toContain("Build the export button");
    expect(note).toContain("1. Make it CSV only");
    expect(note).toContain("- /w/export.ts");
    expect(note).toContain("[in progress] wire the button");
  });

  it("is empty for an orchestrator and for a missing session", async () => {
    const { id } = taskWith("brief");
    db.prepare(`UPDATE sessions SET role = 'orchestrator' WHERE id = ?`).run(
      id
    );
    expect(await compactContext(id)).toBe("");
    expect(await compactContext("nope")).toBe("");
  });
});
