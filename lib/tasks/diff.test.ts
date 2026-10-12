import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, type Session } from "../db";
import { TRUST_HEADER } from "../security/auth";
import { seedSession, seedWorkspace } from "../orchestrator/testing";

vi.mock("./gh", async (orig) => ({
  ...(await orig<typeof import("./gh")>()),
  run: vi.fn(),
}));

const gh = await import("./gh");
const { taskDiff, validDiffPath, capPatch } = await import("./diff");
const route = await import("@/app/api/tasks/[id]/diff/route");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-task-diff-"));
const repo = path.join(root, "repo");
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: repo,
    stdio: "ignore",
  });

const TASK_BASE = "main";
let id: string;
let secret: string;

const session = () =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session;
const get = (idArg: string, query = "", trust = "device") =>
  route.GET(
    new NextRequest(`http://localhost/api/tasks/${idArg}/diff${query}`, {
      headers: { [TRUST_HEADER]: trust },
    }),
    { params: Promise.resolve({ id: idArg }) }
  );

beforeAll(() => {
  fs.mkdirSync(repo);
  git("init", "-q", "-b", TASK_BASE);
  fs.writeFileSync(path.join(repo, "keep.txt"), "one\ntwo\n");
  fs.writeFileSync(path.join(repo, "gone.txt"), "bye\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("switch", "-q", "-c", "feature");
  fs.writeFileSync(path.join(repo, "keep.txt"), "one\ntwo\nthree\n");
  fs.writeFileSync(path.join(repo, "new.txt"), "a\nb\n");
  fs.writeFileSync(path.join(repo, "bin.dat"), Buffer.from([0, 1, 2, 0, 255]));
  fs.writeFileSync(path.join(repo, "big.txt"), "x".repeat(300) + "\n");
  fs.rmSync(path.join(repo, "gone.txt"));
  git("add", "-A");
  git("commit", "-q", "-m", "work");
  // Outside the repo, and not in the change.
  secret = path.join(root, "secret.txt");
  fs.writeFileSync(secret, "TOP-SECRET");
  const { app } = seedWorkspace();
  id = seedSession({ projectId: app.id, name: "diff-task", task: true });
  db.prepare(
    `UPDATE sessions SET worktree_path = ?, base_branch = ?, branch_name = 'feature' WHERE id = ?`
  ).run(repo, TASK_BASE, id);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("task diff", () => {
  it("lists the change with status and counts", async () => {
    const res = await get(id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      source: "worktree",
      base: "main",
      totalFiles: 5,
      truncated: false,
      additions: 1 + 2 + 1,
      deletions: 1,
    });
    expect(body.head).toMatch(/^[0-9a-f]{40}$/);
    const by = Object.fromEntries(
      body.files.map((f: { path: string }) => [f.path, f])
    );
    expect(by["keep.txt"]).toMatchObject({
      status: "M",
      additions: 1,
      deletions: 0,
    });
    expect(by["new.txt"]).toMatchObject({ status: "A", additions: 2 });
    expect(by["gone.txt"]).toMatchObject({ status: "D", deletions: 1 });
    expect(by["bin.dat"]).toMatchObject({ binary: true, additions: null });
  });

  it("returns one file's unified patch", async () => {
    const body = await (await get(id, "?file=keep.txt")).json();
    expect(body).toMatchObject({
      source: "worktree",
      path: "keep.txt",
      truncated: false,
      tooLarge: false,
    });
    expect(body.patch).toContain("+three");
    expect(body.patch).toContain("@@");
  });

  it("caps the file count and the patch bytes and says so", async () => {
    const list = await taskDiff(session(), null, { files: 2, patchBytes: 50 });
    if (!("files" in list)) throw new Error("expected a list");
    expect(list.files).toHaveLength(2);
    expect(list).toMatchObject({ totalFiles: 5, truncated: true });
    const one = await taskDiff(session(), "big.txt", {
      files: 10,
      patchBytes: 120,
    });
    if (!("patch" in one)) throw new Error("expected a patch");
    expect(one.truncated).toBe(true);
    expect(Buffer.byteLength(one.patch ?? "")).toBeLessThanOrEqual(120);
  });

  it("cuts a patch at a line break", () => {
    expect(capPatch("aaa\nbbb\nccc", 9)).toEqual({
      patch: "aaa\nbbb",
      truncated: true,
    });
    expect(capPatch("short", 100)).toEqual({
      patch: "short",
      truncated: false,
    });
  });

  it.each([
    "../secret.txt",
    "a/../../secret.txt",
    "/etc/passwd",
    secretLike(),
    "-p",
    "--output=x",
    "foo\0bar",
    "a\\b",
    "a//b",
    "x".repeat(2000),
  ])("refuses the path %j", async (file) => {
    const res = await get(id, `?file=${encodeURIComponent(file)}`);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("TOP-SECRET");
  });

  it("only serves a file the change lists", async () => {
    // In the repo's history, but not in the change.
    const res = await get(id, "?file=.git/config");
    expect(res.status).toBe(404);
    expect((await get(id, "?file=never.txt")).status).toBe(404);
  });

  it("validates paths", () => {
    expect(validDiffPath("src/a.ts")).toBe(true);
    expect(validDiffPath("")).toBe(false);
    expect(validDiffPath(undefined)).toBe(false);
    expect(validDiffPath("..")).toBe(false);
  });

  it("reads the PR through gh when there is no worktree", async () => {
    const { app } = seedWorkspace();
    const pid = seedSession({ projectId: app.id, name: "pr-only", task: true });
    db.prepare(
      `UPDATE sessions SET pr_number = 7, pr_url = 'https://github.com/o/r/pull/7' WHERE id = ?`
    ).run(pid);
    db.prepare(`UPDATE projects SET working_directory = ? WHERE id = ?`).run(
      repo,
      app.id
    );
    vi.mocked(gh.run).mockImplementation(async (_cmd, args) => {
      if (args[0] === "pr")
        return JSON.stringify({ baseRefName: "main", headRefOid: "abc" });
      return JSON.stringify([
        {
          filename: "a.ts",
          status: "added",
          additions: 3,
          deletions: 0,
          patch: "@@ -0,0 +1 @@\n+x",
        },
        { filename: "b.png", status: "modified", additions: 0, deletions: 0 },
        {
          filename: "c.ts",
          status: "renamed",
          additions: 1,
          deletions: 1,
          patch: "@@",
        },
      ]);
    });
    const list = await (await get(pid)).json();
    expect(list).toMatchObject({
      source: "pr",
      base: "main",
      head: "abc",
      totalFiles: 3,
    });
    expect(list.files.map((f: { status: string }) => f.status)).toEqual([
      "A",
      "M",
      "R",
    ]);
    const patch = await (await get(pid, "?file=a.ts")).json();
    expect(patch).toMatchObject({ source: "pr", patch: "@@ -0,0 +1 @@\n+x" });
    const none = await (await get(pid, "?file=b.png")).json();
    expect(none).toMatchObject({ patch: null, tooLarge: true });
  });

  it("answers 404 for an unknown task, a non-task, and 409 for another machine's", async () => {
    expect((await get("nope")).status).toBe(404);
    const { app } = seedWorkspace();
    const plain = seedSession({ projectId: app.id, name: "chat" });
    expect((await get(plain)).status).toBe(404);
    const mirror = seedSession({ projectId: app.id, name: "m", task: true });
    db.prepare(`UPDATE sessions SET host_id = 'h1' WHERE id = ?`).run(mirror);
    db.prepare(
      `INSERT OR IGNORE INTO hosts (id, name, ssh_target) VALUES ('h1', 'other', 'other')`
    ).run();
    expect((await get(mirror)).status).toBe(409);
  });
});

function secretLike() {
  return "../".repeat(6) + "etc/hosts";
}
