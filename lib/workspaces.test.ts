import { describe, it, expect } from "vitest";
import { db, insertSessionRow } from "@/lib/db";
import {
  createProject,
  deleteProject,
  moveSessionToProject,
} from "@/lib/projects";
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

  it("sends sessions filed in a deleted workspace back to All, keeping the orchestrator's removal", () => {
    const w = createWorkspace("Gone");
    const keep = createWorkspace("Stays");
    const put = (id: string, role: string | null, ws: string) =>
      insertSessionRow(db, {
        id,
        name: id,
        tmux_name: id,
        role,
        workspace_id: ws,
      });
    put("scratch-in-gone", null, w.id);
    put("scratch-in-kept", null, keep.id);
    put("orch-of-gone", "orchestrator", w.id);
    deleteWorkspace(w.id);
    const ws = (id: string) =>
      db.prepare(`SELECT workspace_id FROM sessions WHERE id = ?`).get(id) as
        { workspace_id: string | null } | undefined;
    expect(ws("scratch-in-gone")?.workspace_id).toBeNull();
    expect(ws("scratch-in-kept")?.workspace_id).toBe(keep.id);
    expect(ws("orch-of-gone")).toBeUndefined();
  });

  it("keeps a session's workspace consistent as it moves between projects", () => {
    const w = createWorkspace("Home");
    const project = createProject({ name: "mv", workingDirectory: "/tmp" });
    setProjectWorkspace(project.id, w.id);
    const own = (id: string) =>
      (
        db
          .prepare(`SELECT workspace_id FROM sessions WHERE id = ?`)
          .get(id) as {
          workspace_id: string | null;
        }
      ).workspace_id;
    const put = (id: string, projectId: string, ws: string | null) =>
      insertSessionRow(db, {
        id,
        name: id,
        tmux_name: id,
        project_id: projectId,
        workspace_id: ws,
      });
    // Scratch -> a project: it follows the project.
    put("s1", "uncategorized", w.id);
    moveSessionToProject("s1", project.id);
    expect(own("s1")).toBeNull();
    // Project -> Uncategorized: it stays where the project was.
    moveSessionToProject("s1", "uncategorized");
    expect(own("s1")).toBe(w.id);
    // Deleting a project leaves its sessions in its workspace.
    put("s2", project.id, null);
    deleteProject(project.id);
    expect(own("s2")).toBe(w.id);
  });

  it("refuses an unknown workspace", () => {
    const project = createProject({ name: "beta", workingDirectory: "/tmp" });
    expect(() => setProjectWorkspace(project.id, "nope")).toThrow();
  });
});
