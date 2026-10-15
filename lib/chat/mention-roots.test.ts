import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { createProject, addProjectRepository } from "../projects";
import { setHq } from "../session-logs/hq";
import { createWorkspace, setProjectWorkspace } from "../workspaces";
import { mentionRoots } from "./mention-roots";

const tmp = () =>
  fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "roots-")));
const repo = () => {
  const dir = tmp();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
};
const priv = { visibility: async () => "PRIVATE" };

function session(
  role: string | null,
  workspaceId: string | null,
  cwd = "/tmp"
) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, role, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, "s", `claude-${id}`, cwd, role, workspaceId);
  return id;
}

function project(
  workspaceId: string,
  name: string,
  dir: string,
  hostId?: string
) {
  const p = createProject({
    name,
    workingDirectory: dir,
    hostId,
  });
  setProjectWorkspace(p.id, workspaceId);
  return p;
}

afterEach(() => vi.restoreAllMocks());

describe("mentionRoots", () => {
  it("is nothing for a session that isn't an orchestrator", () => {
    const w = createWorkspace(`ws-${randomUUID()}`);
    expect(mentionRoots(session(null, w.id))).toBeNull();
    expect(mentionRoots(session("task", w.id))).toBeNull();
    expect(mentionRoots(randomUUID())).toBeNull();
  });

  it("lists HQ first, then each project's repositories in order", async () => {
    const w = createWorkspace(`ws-${randomUUID()}`);
    const hq = repo();
    await setHq(w.id, hq, priv);
    const app = repo();
    const api = repo();
    const extra = repo();
    const a = project(w.id, "app", app);
    project(w.id, "api", api);
    addProjectRepository(a.id, { name: "extra", path: extra });
    const roots = mentionRoots(session("orchestrator", w.id))!;
    expect(roots.map((r) => [r.label, r.dir, r.hq])).toEqual([
      ["HQ", hq, true],
      ["app", app, false],
      [path.basename(extra), extra, false],
      ["api", api, false],
    ]);
  });

  it("is just the projects with no HQ, or an HQ that isn't a repository", async () => {
    const w = createWorkspace(`ws-${randomUUID()}`);
    const app = repo();
    project(w.id, "app", app);
    const id = session("orchestrator", w.id);
    expect(mentionRoots(id)!.map((r) => r.label)).toEqual(["app"]);
    const notRepo = tmp();
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(
      `session-logs.hq.${w.id}`,
      JSON.stringify({ folder: notRepo, visibility: "private" })
    );
    expect(mentionRoots(id)!.map((r) => r.label)).toEqual(["app"]);
  });

  it("skips projects on another machine and folders that are gone", () => {
    const w = createWorkspace(`ws-${randomUUID()}`);
    const here = repo();
    project(w.id, "here", here);
    project(w.id, "gone", path.join(tmp(), "missing"));
    const other = db.prepare(`SELECT id FROM hosts LIMIT 1`).get() as
      | { id: string }
      | undefined;
    if (other) project(w.id, "remote", repo(), other.id);
    expect(
      mentionRoots(session("orchestrator", w.id))!.map((r) => r.label)
    ).toEqual(["here"]);
  });

  it("never searches the home folder", () => {
    const home = tmp();
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const w = createWorkspace(`ws-${randomUUID()}`);
    project(w.id, "oops", home);
    const scratch = tmp();
    const roots = mentionRoots(session("orchestrator", w.id, scratch))!;
    expect(roots).toEqual([{ dir: scratch, label: "scratch", hq: false }]);
  });

  it("keeps one root when HQ and a project are the same folder", () => {
    const w = createWorkspace(`ws-${randomUUID()}`);
    const same = repo();
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(
      `session-logs.hq.${w.id}`,
      JSON.stringify({ folder: same, visibility: "private" })
    );
    project(w.id, "app", same);
    expect(
      mentionRoots(session("orchestrator", w.id))!.map((r) => r.label)
    ).toEqual(["HQ"]);
  });

  it("searches the scratch folder when nothing else is there", () => {
    const w = createWorkspace(`ws-${randomUUID()}`);
    const scratch = tmp();
    expect(mentionRoots(session("orchestrator", w.id, scratch))).toEqual([
      { dir: scratch, label: "scratch", hq: false },
    ]);
  });

  it("stops at eight roots", () => {
    const w = createWorkspace(`ws-${randomUUID()}`);
    for (let i = 0; i < 10; i++) project(w.id, `p${i}`, repo());
    expect(mentionRoots(session("orchestrator", w.id))).toHaveLength(8);
  });
});
