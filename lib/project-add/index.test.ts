import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getProject } from "../projects";
import {
  getCloneJob,
  initProject,
  listFolders,
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
