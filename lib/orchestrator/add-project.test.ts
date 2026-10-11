import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { describe, expect, it } from "vitest";
import { getProject } from "@/lib/projects";
import { addFolder } from "@/lib/project-add";
import { createWorkspace } from "@/lib/workspaces";
import { runTool } from "./serve";
import { listNotes } from "./notes";

const repo = (branch = "trunk") => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "aos-orch-add-"));
  execFileSync("git", ["init", "-q", "-b", branch], { cwd: dir });
  return dir;
};

describe("add_project", () => {
  it("adds a git repository to its own workspace, saying its default branch", async () => {
    const ws = createWorkspace("Orch Tools");
    const dir = repo();
    const text = await runTool(ws.id, "add_project", {
      path: dir,
      name: "orch-tool",
    });
    expect(text).toMatch(
      /^Added project orch-tool \(.*, default branch trunk\)/
    );
    const added = (await addFolder("local", dir, { moveExisting: true }))
      .project;
    expect(added.name).toBe("orch-tool");
    expect(getProject(added.id)?.workspace_id).toBe(ws.id);
    expect(
      listNotes(ws.id).some((n) => /Added project orch-tool/.test(n.text))
    ).toBe(true);
  });

  it("moves a project in no workspace in, rather than making another", async () => {
    const mine = createWorkspace("Mine");
    const dir = repo();
    const first = (await addFolder("local", dir)).project;
    expect(await runTool(mine.id, "add_project", { path: dir })).toMatch(
      /^Moved project .* in from no workspace/
    );
    expect(getProject(first.id)?.workspace_id).toBe(mine.id);
    expect(await runTool(mine.id, "add_project", { path: dir })).toMatch(
      /already in this workspace/
    );
  });

  it("never takes a project from another workspace", async () => {
    const other = createWorkspace("Elsewhere");
    const mine = createWorkspace("Mine too");
    const dir = repo();
    const first = (await addFolder("local", dir, { workspaceId: other.id }))
      .project;
    await expect(
      runTool(mine.id, "add_project", { path: dir })
    ).rejects.toThrow(/belongs to the Elsewhere workspace/);
    expect(getProject(first.id)?.workspace_id).toBe(other.id);
  });

  it("refuses a folder that isn't a repository, holds secrets, or is relative", async () => {
    const ws = createWorkspace("Strict");
    const plain = fs.mkdtempSync(path.join(tmpdir(), "aos-orch-plain-"));
    await expect(
      runTool(ws.id, "add_project", { path: plain })
    ).rejects.toThrow(/isn't a git repository/);
    await expect(
      runTool(ws.id, "add_project", { path: "~/.ssh" })
    ).rejects.toThrow(/secrets/);
    // A repository behind a symlink is judged by where it points.
    const vault = path.join(
      fs.mkdtempSync(path.join(tmpdir(), "aos-")),
      "tokenvault"
    );
    fs.mkdirSync(vault);
    execFileSync("git", ["init", "-q"], { cwd: vault });
    const link = path.join(
      fs.mkdtempSync(path.join(tmpdir(), "aos-")),
      "notes"
    );
    fs.symlinkSync(vault, link);
    await expect(runTool(ws.id, "add_project", { path: link })).rejects.toThrow(
      /secrets/
    );
    await expect(
      runTool(ws.id, "add_project", { path: "dev/thing" })
    ).rejects.toThrow(/absolute path/);
    await expect(
      runTool(ws.id, "add_project", { path: plain, name: "../x" })
    ).rejects.toThrow(/Bad arguments/);
  });
});
