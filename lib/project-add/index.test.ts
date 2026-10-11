import fs from "fs";
import os, { tmpdir } from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getProject } from "../projects";
import { createWorkspace } from "../workspaces";
import {
  addFolder,
  getCloneJob,
  initProject,
  isSecretPath,
  listFolders,
  ProjectExistsError,
  repoNameOf,
  startClone,
} from "./index";

const temp = () => fs.mkdtempSync(path.join(tmpdir(), "aos-add-"));

async function until(check: () => boolean, ms = 15_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

// No git identity, global config or hooks from the machine running this.
const saved = { ...process.env };
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});
afterAll(() => {
  process.env = saved;
});

describe("adding a project", () => {
  it("names a repository from its URL", () => {
    expect(repoNameOf("https://github.com/o/agent-os.git")).toBe("agent-os");
    expect(repoNameOf("git@github.com:o/repo")).toBe("repo");
    expect(repoNameOf("https://github.com/o/")).toBe("o");
  });

  it("lists a folder's visible subfolders and whether it's a repo", async () => {
    const dir = temp();
    fs.mkdirSync(path.join(dir, "b"));
    fs.mkdirSync(path.join(dir, "a"));
    fs.mkdirSync(path.join(dir, ".hidden"));
    fs.writeFileSync(path.join(dir, "file"), "");
    const listing = await listFolders("local", dir);
    expect(listing.folders).toEqual(["a", "b"]);
    expect(listing.isGitRepo).toBe(false);
    expect(listing.warning).toBeNull();
    expect(listing.parent).toBe(path.dirname(listing.path));
  });

  it("starts a project from a name: folder, git init, first commit", async () => {
    const parent = temp();
    const project = await initProject("local", parent, "new-thing");
    const dir = project.working_directory;
    expect(fs.realpathSync(dir)).toBe(
      fs.realpathSync(path.join(parent, "new-thing"))
    );
    expect(
      execFileSync("git", ["log", "--format=%s"], {
        cwd: dir,
        encoding: "utf8",
      }).trim()
    ).toBe("Initial commit");
    expect(getProject(project.id)?.name).toBe("new-thing");
  });

  it("refuses names a shell or a path could misread, making nothing", async () => {
    const parent = temp();
    for (const name of ["../up", "a b", "-rf", "x;rm", ""])
      await expect(initProject("local", parent, name)).rejects.toThrow(
        /letters, numbers, dots/
      );
    expect(fs.readdirSync(parent)).toEqual([]);
    expect(fs.existsSync(path.join(parent, "..", "up"))).toBe(false);
  });

  it("refuses a URL that isn't a repository's", () => {
    for (const url of [
      "--upload-pack=touch /tmp/x",
      "https://h/o/r'; rm",
      "https://h/o/$(id)",
      "file:///etc",
    ])
      expect(() => startClone("local", temp(), url)).toThrow(
        /isn't a repository URL/
      );
  });

  it("runs at most four clones at once", async () => {
    // Port 9 on this machine never answers, so each clone waits there.
    const hang = "https://127.0.0.1:9/never/r.git";
    const parent = temp();
    const running = [1, 2, 3, 4].map(() => startClone("local", parent, hang));
    expect(() => startClone("local", parent, hang)).toThrow(/Too many clones/);
    await until(() =>
      running.every((j) => getCloneJob(j.id)?.status !== "running")
    );
    expect(startClone("local", parent, hang).status).toBe("running");
  });

  it("follows a clone and reports git's own error when it fails", async () => {
    // Nothing serves this URL: the job fails, saying why.
    const job = startClone(
      "local",
      temp(),
      "https://localhost:9/never/lib.git"
    );
    expect(job.status).toBe("running");
    await until(() => getCloneJob(job.id)?.status !== "running");
    expect(getCloneJob(job.id)?.status).toBe("failed");
    expect(getCloneJob(job.id)?.error).toMatch(
      /unable to access|Failed to connect|Could not resolve|Connection refused/i
    );
  });
});

describe("adding a project to a workspace", () => {
  it("puts a new project from a name or a folder in the workspace given", async () => {
    const ws = createWorkspace("Internal Tools");
    const made = await initProject("local", temp(), "tool-a", ws.id);
    expect(getProject(made.id)?.workspace_id).toBe(ws.id);

    const { project, outcome } = await addFolder("local", temp(), {
      workspaceId: ws.id,
    });
    expect(outcome).toBe("created");
    expect(getProject(project.id)?.workspace_id).toBe(ws.id);

    const loose = await addFolder("local", temp());
    expect(getProject(loose.project.id)?.workspace_id).toBeNull();
  });

  it("refuses a workspace that doesn't exist before making anything", async () => {
    const parent = temp();
    await expect(
      initProject("local", parent, "ghost", "no-such-workspace")
    ).rejects.toThrow(/Unknown workspace/);
    expect(fs.readdirSync(parent)).toEqual([]);
    expect(() =>
      startClone("local", parent, "https://h/o/r.git", "no-such-workspace")
    ).toThrow(/Unknown workspace/);
  });

  it("never makes a second project of the same folder, and moves the first when asked", async () => {
    const a = createWorkspace("A");
    const b = createWorkspace("B");
    const dir = temp();
    const first = (await addFolder("local", dir, { workspaceId: a.id }))
      .project;

    const again = addFolder("local", `${dir}/`, { workspaceId: b.id });
    await expect(again).rejects.toBeInstanceOf(ProjectExistsError);
    await expect(again).rejects.toMatchObject({
      project: { id: first.id, workspace_id: a.id },
    });

    const moved = await addFolder("local", dir, {
      workspaceId: b.id,
      moveExisting: true,
    });
    expect(moved).toMatchObject({ outcome: "moved", from: a.id });
    expect(moved.project.id).toBe(first.id);
    expect(getProject(first.id)?.workspace_id).toBe(b.id);

    const same = await addFolder("local", dir, {
      workspaceId: b.id,
      moveExisting: true,
    });
    expect(same.outcome).toBe("unchanged");
  });

  it("refuses folders that hold secrets, and a non-repo when a repo is required", async () => {
    for (const p of [
      "~/.ssh",
      `${os.homedir()}/.aws/x`,
      "/srv/tokenvault",
      "~/.config/gh",
    ])
      expect(isSecretPath(p)).toBe(true);
    expect(isSecretPath("~/.CONFIG/gh")).toBe(true);
    expect(isSecretPath("~/dev/config-tool")).toBe(false);
    await expect(addFolder("local", "~/.ssh")).rejects.toThrow(/secrets/);
    await expect(
      addFolder("local", temp(), { requireGit: true })
    ).rejects.toThrow(/isn't a git repository/);
  });

  it("judges a symlinked folder by where it points", async () => {
    const keys = path.join(temp(), ".ssh");
    fs.mkdirSync(keys);
    const link = path.join(temp(), "notes");
    fs.symlinkSync(keys, link);
    await expect(addFolder("local", link)).rejects.toThrow(/secrets/);
  });
});
