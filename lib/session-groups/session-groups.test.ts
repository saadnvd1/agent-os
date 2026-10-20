import { describe, expect, it } from "vitest";
import { db, insertSessionRow } from "@/lib/db";
import { createProject, moveSessionToProject } from "@/lib/projects";
import { createWorkspace, setProjectWorkspace } from "@/lib/workspaces";
import {
  GroupError,
  assignSessions,
  createGroup,
  deleteGroup,
  inheritGroup,
  listGroups,
  reorderGroups,
  resolveGroup,
  restoreGroup,
  updateGroup,
} from "./index";

let n = 0;
const uid = (p: string) =>
  `${p}-${++n}-${Math.random().toString(36).slice(2, 6)}`;

function workspace() {
  const w = createWorkspace(uid("ws"));
  const project = createProject({
    name: uid("proj"),
    workingDirectory: "/tmp",
  });
  setProjectWorkspace(project.id, w.id);
  return { w, project };
}

function session(
  projectId: string | null = null,
  workspaceId: string | null = null
) {
  const id = uid("s");
  insertSessionRow(db, {
    id,
    name: id,
    tmux_name: id,
    project_id: projectId,
    workspace_id: workspaceId,
  });
  return id;
}

const groupOf = (id: string) =>
  (
    db
      .prepare(`SELECT session_group_id AS g FROM sessions WHERE id = ?`)
      .get(id) as {
      g: string | null;
    }
  ).g;

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof GroupError ? e.code : "other";
  }
  return null;
};

describe("groups", () => {
  it("creates at the bottom, trims, and refuses a duplicate name per workspace", () => {
    const { w } = workspace();
    const other = workspace().w;
    const a = createGroup(w.id, "  Launch  ");
    const b = createGroup(w.id, "Watching");
    expect(a.name).toBe("Launch");
    expect(b.sort_order).toBeGreaterThan(a.sort_order);
    expect(code(() => createGroup(w.id, "launch"))).toBe("duplicate");
    expect(createGroup(other.id, "Launch").workspace_id).toBe(other.id);
    expect(code(() => createGroup(w.id, "   "))).toBe("invalid");
    expect(code(() => createGroup("nope", "X"))).toBe("not-found");
  });

  it("renames and folds, keeping names unique", () => {
    const { w } = workspace();
    const a = createGroup(w.id, "A");
    createGroup(w.id, "B");
    expect(updateGroup(a.id, { collapsed: true }).collapsed).toBe(true);
    expect(updateGroup(a.id, { name: "A2" }).name).toBe("A2");
    expect(updateGroup(a.id, { name: "a2" }).name).toBe("a2");
    expect(code(() => updateGroup(a.id, { name: "b" }))).toBe("duplicate");
  });

  it("reorders within a workspace and refuses a stranger's group", () => {
    const { w } = workspace();
    const a = createGroup(w.id, "A");
    const b = createGroup(w.id, "B");
    const c = createGroup(w.id, "C");
    const out = reorderGroups(w.id, [c.id, a.id]).map((g) => g.name);
    expect(out).toEqual(["C", "A", "B"]);
    const stranger = createGroup(workspace().w.id, "Z");
    expect(code(() => reorderGroups(w.id, [stranger.id, b.id]))).toBe(
      "workspace"
    );
  });

  it("resolves a name, and lists the ones that exist when it misses", () => {
    const { w } = workspace();
    createGroup(w.id, "Launch");
    expect(resolveGroup(w.id, "launch").name).toBe("Launch");
    expect(() => resolveGroup(w.id, "Nope")).toThrow(/Groups: "Launch"/);
    expect(() => resolveGroup(workspace().w.id, "Nope")).toThrow(/no groups/);
  });
});

describe("membership", () => {
  it("joins only a group of the session's own workspace", () => {
    const { w, project } = workspace();
    const { w: w2, project: p2 } = workspace();
    const g = createGroup(w.id, "Launch");
    const mine = session(project.id);
    const theirs = session(p2.id);
    assignSessions([mine], g.id);
    expect(groupOf(mine)).toBe(g.id);
    expect(code(() => assignSessions([theirs], g.id))).toBe("workspace");
    expect(groupOf(theirs)).toBeNull();
    expect(createGroup(w2.id, "Other").workspace_id).toBe(w2.id);
  });

  it("is all or none for a bulk move", () => {
    const { w, project } = workspace();
    const p2 = workspace().project;
    const g = createGroup(w.id, "Launch");
    const a = session(project.id);
    const b = session(p2.id);
    expect(code(() => assignSessions([a, b], g.id))).toBe("workspace");
    expect(groupOf(a)).toBeNull();
    expect(assignSessions([a], g.id)).toEqual({ moved: 1 });
    expect(assignSessions([a], g.id)).toEqual({ moved: 0 });
    assignSessions([a], null);
    expect(groupOf(a)).toBeNull();
    expect(code(() => assignSessions(["missing"], null))).toBe("not-found");
  });

  it("puts a scratch session in a no-workspace group, and a scratch session of a workspace in that workspace's", () => {
    const { w } = workspace();
    const none = createGroup(null, "Loose");
    const scratchNone = session("uncategorized", null);
    const scratchWs = session("uncategorized", w.id);
    assignSessions([scratchNone], none.id);
    expect(groupOf(scratchNone)).toBe(none.id);
    expect(code(() => assignSessions([scratchWs], none.id))).toBe("workspace");
    assignSessions([scratchWs], createGroup(w.id, "Mine").id);
  });

  it("does not touch updated_at", () => {
    const { w, project } = workspace();
    const s = session(project.id);
    db.prepare(
      `UPDATE sessions SET updated_at = '2026-10-01 10:00:00' WHERE id = ?`
    ).run(s);
    assignSessions([s], createGroup(w.id, "T").id);
    expect(
      (
        db.prepare(`SELECT updated_at FROM sessions WHERE id = ?`).get(s) as {
          updated_at: string;
        }
      ).updated_at
    ).toBe("2026-10-01 10:00:00");
  });

  it("refuses a deleted group", () => {
    const { w, project } = workspace();
    const g = createGroup(w.id, "Gone");
    deleteGroup(g.id);
    expect(code(() => assignSessions([session(project.id)], g.id))).toBe(
      "deleted"
    );
  });
});

describe("delete and restore", () => {
  it("soft deletes, keeps members, and restores them", () => {
    const { w, project } = workspace();
    const g = createGroup(w.id, "Launch");
    const s = session(project.id);
    assignSessions([s], g.id);
    deleteGroup(g.id);
    expect(listGroups(w.id).map((x) => x.id)).not.toContain(g.id);
    expect(groupOf(s)).toBe(g.id);
    expect(restoreGroup(g.id).name).toBe("Launch");
    expect(listGroups(w.id).map((x) => x.id)).toContain(g.id);
  });

  it("frees the name while deleted, and refuses a restore that would clash", () => {
    const { w } = workspace();
    const g = createGroup(w.id, "Launch");
    deleteGroup(g.id);
    createGroup(w.id, "Launch");
    expect(code(() => restoreGroup(g.id))).toBe("duplicate");
    expect(code(() => deleteGroup(g.id))).toBe("deleted");
  });
});

describe("leaving a workspace", () => {
  it("clears the group when the session moves to a project in another workspace", () => {
    const { w, project } = workspace();
    const other = workspace().project;
    const s = session(project.id);
    assignSessions([s], createGroup(w.id, "Launch").id);
    const out = moveSessionToProject(s, other.id);
    expect(out.clearedGroup).toBe("Launch");
    expect(groupOf(s)).toBeNull();
  });

  it("keeps it when the move stays in the workspace", () => {
    const { w, project } = workspace();
    const sibling = createProject({
      name: uid("sib"),
      workingDirectory: "/tmp",
    });
    setProjectWorkspace(sibling.id, w.id);
    const s = session(project.id);
    const g = createGroup(w.id, "Launch");
    assignSessions([s], g.id);
    expect(moveSessionToProject(s, sibling.id).clearedGroup).toBeNull();
    expect(groupOf(s)).toBe(g.id);
  });

  it("clears members when their project changes workspace", () => {
    const { w, project } = workspace();
    const s = session(project.id);
    assignSessions([s], createGroup(w.id, "Launch").id);
    setProjectWorkspace(project.id, workspace().w.id);
    expect(groupOf(s)).toBeNull();
  });
});

describe("inheritGroup", () => {
  it("copies a live group in the same workspace, otherwise nothing", () => {
    const { w, project } = workspace();
    const g = createGroup(w.id, "Launch");
    const parent = session(project.id);
    assignSessions([parent], g.id);
    const child = session(project.id);
    inheritGroup(parent, child);
    expect(groupOf(child)).toBe(g.id);
    const foreign = session(workspace().project.id);
    inheritGroup(parent, foreign);
    expect(groupOf(foreign)).toBeNull();
    deleteGroup(g.id);
    const late = session(project.id);
    inheritGroup(parent, late);
    expect(groupOf(late)).toBeNull();
  });
});
