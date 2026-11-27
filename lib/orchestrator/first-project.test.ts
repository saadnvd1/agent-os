import os from "os";
import { execFileSync } from "child_process";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db } from "@/lib/db";
import { putSetting } from "@/lib/settings-store";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
} from "@/lib/workspaces";
import { addFolder, initProject } from "@/lib/project-add";
import { tempDir } from "@/lib/test-temp";
import { listOrchestrators } from "./home";
import { afterProjectAdded, autoOrchestratorsOff } from "./first-project";

beforeAll(() => {
  vi.spyOn(os, "homedir").mockReturnValue(tempDir("aos-first-home-"));
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});

const repo = () => {
  const dir = tempDir("aos-first-repo-");
  execFileSync("git", ["init", "-q", dir]);
  return dir;
};

// Each test starts as a fresh install: no workspaces, no projects.
function freshInstall() {
  for (const w of listWorkspaces()) deleteWorkspace(w.id);
  db.prepare(`DELETE FROM projects WHERE is_uncategorized = 0`).run();
  putSetting("orchestrators.auto", null);
  delete process.env.AGENTOS_ORCHESTRATORS;
}
beforeEach(freshInstall);
afterEach(freshInstall);

describe("a new user's first project", () => {
  it("lands in a default workspace that gets exactly one orchestrator", async () => {
    const { project } = await addFolder("local", repo());
    const workspaces = listWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(project.workspace_id).toBe(workspaces[0].id);
    const orchestrators = listOrchestrators();
    expect(orchestrators).toHaveLength(1);
    expect(orchestrators[0]).toMatchObject({
      workspace_id: workspaces[0].id,
      pinned: 1,
    });
  });

  it("adds no second orchestrator or workspace for a second project", async () => {
    const first = await addFolder("local", repo());
    const wid = first.project.workspace_id!;
    const second = await addFolder("local", repo(), { workspaceId: wid });
    expect(second.project.workspace_id).toBe(wid);
    expect(listWorkspaces()).toHaveLength(1);
    expect(listOrchestrators()).toHaveLength(1);
  });

  it("leaves a later project with no workspace alone", async () => {
    await addFolder("local", repo());
    const later = await addFolder("local", repo());
    expect(later.project.workspace_id).toBeNull();
    expect(listWorkspaces()).toHaveLength(1);
    expect(listOrchestrators()).toHaveLength(1);
  });

  it("covers a project started from a name", async () => {
    const project = await initProject(
      "local",
      tempDir("aos-first-parent-"),
      "demo"
    );
    expect(project.workspace_id).toBe(listWorkspaces()[0].id);
    expect(listOrchestrators()).toHaveLength(1);
  });

  it("makes one for an existing empty workspace's first project", async () => {
    const w = createWorkspace("Work");
    await addFolder("local", repo(), { workspaceId: w.id });
    expect(listOrchestrators().map((o) => o.workspace_id)).toEqual([w.id]);
  });

  it("doesn't make one for a workspace that already had projects", async () => {
    const w = createWorkspace("Work");
    const a = await addFolder("local", repo(), { workspaceId: w.id });
    db.prepare(`DELETE FROM sessions WHERE role = 'orchestrator'`).run();
    await addFolder("local", repo(), { workspaceId: w.id });
    expect(a.project.workspace_id).toBe(w.id);
    expect(listOrchestrators()).toHaveLength(0);
  });

  it("still adds the project when the orchestrator can't be made", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => afterProjectAdded("no-such-workspace")).not.toThrow();
  });

  it("is off with the setting", async () => {
    putSetting("orchestrators.auto", "off");
    const { project } = await addFolder("local", repo());
    expect(project.workspace_id).toBeNull();
    expect(listWorkspaces()).toHaveLength(0);
    expect(listOrchestrators()).toHaveLength(0);
  });

  it("is off with AGENTOS_ORCHESTRATORS=off, even for a given workspace", async () => {
    expect(autoOrchestratorsOff({ AGENTOS_ORCHESTRATORS: "off" })).toBe(true);
    process.env.AGENTOS_ORCHESTRATORS = "off";
    const w = createWorkspace("Work");
    await addFolder("local", repo(), { workspaceId: w.id });
    expect(listOrchestrators()).toHaveLength(0);
  });
});
