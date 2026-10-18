import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { createProject } from "../projects";
import { createWorkspace, setProjectWorkspace } from "../workspaces";
import { setLogFolder, destination, writeLogFileTo } from "./folder";
import { commitLogs, getHq, setHq } from "./hq";
import { reexportLogs } from "./reexport";
import { insertLog, getLog } from "./store";
import { tempDir } from "@/lib/test-temp";

const tmp = () => fs.realpathSync(tempDir("hq-"));
const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

function repo() {
  const dir = tmp();
  sh(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "README.md"), "hq\n");
  sh(dir, "add", ".");
  sh(dir, "commit", "-qm", "init");
  return dir;
}

// An HQ repo with a bare remote it tracks.
function repoWithRemote() {
  const bare = tmp();
  sh(bare, "init", "-q", "--bare", "-b", "main");
  const dir = repo();
  sh(dir, "remote", "add", "origin", bare);
  sh(dir, "push", "-qu", "origin", "main");
  return { dir, bare };
}

function workspace() {
  const w = createWorkspace(`ws-${path.basename(tmp())}`);
  const projectRepo = repo();
  const p = createProject({
    name: `My API ${path.basename(projectRepo)}`,
    workingDirectory: projectRepo,
  });
  setProjectWorkspace(p.id, w.id);
  return { w, p, projectRepo };
}

const priv = { visibility: async () => "PRIVATE" };

const target = (
  w: { id: string; name: string },
  p: { id: string; name: string }
) => ({
  workspace: w.name,
  workspaceId: w.id,
  project: p.name,
  projectId: p.id,
  name: "Add login",
  id: "1234567890abcdef",
  day: "2026-10-12",
});

describe("setHq validation", () => {
  it("refuses a folder that isn't a git repository", async () => {
    const { w } = workspace();
    await expect(setHq(w.id, tmp(), priv)).rejects.toThrow(
      /isn't a git repository/
    );
    expect(getHq(w.id)).toBeNull();
  });

  it("refuses a folder inside, or equal to, a project's repository", async () => {
    const { w, projectRepo } = workspace();
    await expect(setHq(w.id, projectRepo, priv)).rejects.toThrow(
      /project's repository/
    );
    const nested = path.join(projectRepo, "hq");
    fs.mkdirSync(nested);
    sh(nested, "init", "-q");
    await expect(setHq(w.id, nested, priv)).rejects.toThrow(
      /project's repository/
    );
  });

  it("refuses a public remote and one it can't check", async () => {
    const { w } = workspace();
    const { dir } = repoWithRemote();
    await expect(
      setHq(w.id, dir, { visibility: async () => "PUBLIC" })
    ).rejects.toThrow(/is public/);
    await expect(
      setHq(w.id, dir, {
        visibility: async () => {
          throw new Error("offline");
        },
      })
    ).rejects.toThrow(/Couldn't check/);
    expect(getHq(w.id)).toBeNull();
  });

  it("stores the visibility; a repo with no remote is local only", async () => {
    const { w } = workspace();
    const { dir } = repoWithRemote();
    const check = vi.fn(async () => "PRIVATE");
    await setHq(w.id, dir, { visibility: check });
    expect(check).toHaveBeenCalledTimes(1);
    expect(getHq(w.id)).toEqual({ folder: dir, visibility: "private" });
    const local = repo();
    await setHq(w.id, local, { visibility: check });
    expect(getHq(w.id)).toEqual({ folder: local, visibility: "none" });
    expect(check).toHaveBeenCalledTimes(1);
    await setHq(w.id, "", priv);
    expect(getHq(w.id)).toBeNull();
  });
});

describe("destination priority", () => {
  it("is the project's folder, then the HQ, then the default", async () => {
    const { w, p } = workspace();
    const t = target(w, p);
    expect(destination(t).hq).toBeNull();
    expect(destination(t).dir).toContain(path.join("session-logs"));

    const hq = repo();
    await setHq(w.id, hq, priv);
    const d = destination(t);
    expect(d.dir).toBe(
      path.join(hq, "docs", "sessions", d.dir.split(path.sep).pop()!)
    );
    expect(d.hq).toEqual({ dir: hq, visibility: "none" });

    const own = tmp();
    setLogFolder(p.id, own);
    expect(destination(t)).toEqual({ dir: own, hq: null });
  });

  it("falls back to the default when the HQ is gone", async () => {
    const { w, p } = workspace();
    const hq = repo();
    await setHq(w.id, hq, priv);
    fs.rmSync(hq, { recursive: true });
    expect(destination(target(w, p)).hq).toBeNull();
  });
});

describe("commitLogs", () => {
  it("commits exactly the one file, leaving other changes alone", async () => {
    const { w, p } = workspace();
    const hq = repo();
    await setHq(w.id, hq, priv);
    fs.writeFileSync(path.join(hq, "README.md"), "edited\n");
    fs.writeFileSync(path.join(hq, "staged.txt"), "x");
    sh(hq, "add", "staged.txt");
    const { file } = writeLogFileTo(target(w, p), "# log\n");
    await commitLogs(hq, [file], "session log: Add login", "none");
    expect(
      sh(hq, "show", "--name-only", "--format=%s", "HEAD").trim().split("\n")
    ).toEqual(["session log: Add login", "", path.relative(hq, file)]);
    const status = sh(hq, "status", "--porcelain");
    expect(status).toContain("M README.md");
    expect(status).toContain("A  staged.txt");
  });

  it("pushes to the upstream when private, and not otherwise", async () => {
    const { dir, bare } = repoWithRemote();
    const f = path.join(dir, "a.md");
    fs.writeFileSync(f, "a");
    await commitLogs(dir, [f], "session log: a", "internal");
    expect(sh(bare, "log", "--format=%s", "main").trim().split("\n")).toEqual([
      "init",
    ]);
    const g = path.join(dir, "b.md");
    fs.writeFileSync(g, "b");
    await commitLogs(dir, [g], "session log: b", "private");
    // the earlier unpushed commit goes along with this one
    expect(sh(bare, "log", "--format=%s", "main").trim().split("\n")).toEqual([
      "session log: b",
      "session log: a",
      "init",
    ]);
  });

  it("doesn't throw when the push fails, and the next push carries it", async () => {
    const { dir, bare } = repoWithRemote();
    const moved = `${bare}-moved`;
    fs.renameSync(bare, moved);
    const f = path.join(dir, "a.md");
    fs.writeFileSync(f, "a");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      commitLogs(dir, [f], "session log: a", "private")
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    expect(sh(dir, "log", "--format=%s", "-1").trim()).toBe("session log: a");
    fs.renameSync(moved, bare);
    const g = path.join(dir, "b.md");
    fs.writeFileSync(g, "b");
    await commitLogs(dir, [g], "session log: b", "private");
    expect(
      sh(bare, "log", "--format=%s", "main").trim().split("\n")
    ).toHaveLength(3);
  });

  it("serializes commits to one HQ", async () => {
    const hq = repo();
    const files = Array.from({ length: 6 }, (_, i) => {
      const f = path.join(hq, `${i}.md`);
      fs.writeFileSync(f, String(i));
      return f;
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await Promise.all(
      files.map((f, i) => commitLogs(hq, [f], `session log: ${i}`, "none"))
    );
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
    const subjects = sh(hq, "log", "--format=%s").trim().split("\n");
    expect(subjects).toHaveLength(7);
    expect(subjects.slice(0, 6).sort()).toEqual(
      files.map((_, i) => `session log: ${i}`).sort()
    );
    expect(
      sh(hq, "show", "--name-only", "--format=", "HEAD").trim().split("\n")
    ).toHaveLength(1);
  });
});

describe("reexportLogs", () => {
  it("writes stored logs to the HQ from their markdown and commits once", async () => {
    const { w, p } = workspace();
    const old = tmp();
    const ids = ["a1111111-x", "b2222222-x"];
    ids.forEach((id, i) => {
      const f = path.join(old, `${i}.md`);
      fs.writeFileSync(f, `# log ${i}\n`);
      db.prepare(
        `INSERT OR IGNORE INTO sessions (id, name, project_id) VALUES (?, ?, ?)`
      ).run(id, `t${i}`, p.id);
      insertLog({
        sessionId: id,
        projectId: p.id,
        workspaceId: w.id,
        markdown: `# log ${i}\n`,
        header: {
          id,
          name: `Task ${i}`,
          workspace: w.name,
          project: p.name,
          branch: null,
          prNumber: null,
          prUrl: null,
          mergeCommit: null,
          startedAt: null,
          mergedAt: "2026-10-12 10:00:00",
          durationMs: null,
          costUsd: 0,
          planKept: false,
          hasPlan: false,
        },
        filePath: f,
      });
    });
    const hq = repo();
    await setHq(w.id, hq, priv);
    const before = sh(hq, "rev-list", "--count", "HEAD").trim();
    const r = await reexportLogs();
    expect(r).toMatchObject({ moved: 2, failed: 0 });
    expect(Number(sh(hq, "rev-list", "--count", "HEAD").trim())).toBe(
      Number(before) + 1
    );
    const logged = getLog(ids[0])!;
    expect(
      logged.file_path!.startsWith(path.join(hq, "docs", "sessions"))
    ).toBe(true);
    expect(fs.readFileSync(logged.file_path!, "utf8")).toBe("# log 0\n");
    expect(fs.existsSync(path.join(old, "0.md"))).toBe(true);
    expect(await reexportLogs()).toMatchObject({ moved: 0, unchanged: 2 });
  });
});
