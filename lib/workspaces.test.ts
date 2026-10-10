import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { createProject } from "@/lib/projects";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  setProjectWorkspace,
  updateWorkspace,
} from "@/lib/workspaces";

const workspaceOf = (projectId: string) =>
  (
    db
      .prepare(`SELECT workspace_id FROM projects WHERE id = ?`)
      .get(projectId) as {
      workspace_id: string | null;
    }
  ).workspace_id;

describe("workspaces", () => {
  it("creates in order and trims names", () => {
    const a = createWorkspace("  Work ");
    const b = createWorkspace("Personal");
    expect(a.name).toBe("Work");
    const names = listWorkspaces().map((w) => w.name);
    expect(names.indexOf("Work")).toBeLessThan(names.indexOf("Personal"));
    expect(b.collapsed).toBe(false);
  });

  it("takes a running task limit from 1, or none, and refuses anything else", () => {
    const w = createWorkspace("Limits");
    expect(w.max_running_tasks).toBeNull();
    expect(
      updateWorkspace(w.id, { maxRunningTasks: 3 })?.max_running_tasks
    ).toBe(3);
    for (const bad of [0, -1, 1.5, "3"])
      expect(() =>
        updateWorkspace(w.id, { maxRunningTasks: bad as number })
      ).toThrow(/whole number from 1/);
    expect(updateWorkspace(w.id, { name: "Kept" })?.max_running_tasks).toBe(3);
    expect(
      updateWorkspace(w.id, { maxRunningTasks: null })?.max_running_tasks
    ).toBeNull();
  });

  it("rejects an empty name", () => {
    expect(() => createWorkspace("   ")).toThrow();
  });

  it("persists collapse and rename", () => {
    const w = createWorkspace("Temp");
    updateWorkspace(w.id, { collapsed: true, name: "Renamed" });
    const after = listWorkspaces().find((x) => x.id === w.id)!;
    expect(after).toMatchObject({ collapsed: true, name: "Renamed" });
  });

  it("moves projects in and out, and deleting keeps the project", () => {
    const w = createWorkspace("Clients");
    const project = createProject({ name: "acme", workingDirectory: "/tmp" });
    setProjectWorkspace(project.id, w.id);
    expect(workspaceOf(project.id)).toBe(w.id);

    deleteWorkspace(w.id);
    expect(workspaceOf(project.id)).toBeNull();
    expect(listWorkspaces().some((x) => x.id === w.id)).toBe(false);
  });

  it("refuses an unknown workspace", () => {
    const project = createProject({ name: "beta", workingDirectory: "/tmp" });
    expect(() => setProjectWorkspace(project.id, "nope")).toThrow();
  });
});
