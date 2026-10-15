import { randomUUID } from "crypto";
import fs from "fs";
import { describe, expect, it } from "vitest";
import { git, makeRepo } from "@/lib/done/testing";

const { db } = await import("@/lib/db");
const { createProject } = await import("@/lib/projects");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { recordSwept } = await import("@/lib/worktree-sweep/store");
const { restoreSwept, sweptNote } = await import("./swept");
import type { Session } from "@/lib/db";

function swept(branchExists: boolean) {
  const r = makeRepo();
  const project = createProject({
    name: `app-${randomUUID().slice(0, 8)}`,
    workingDirectory: r.repo,
  });
  const branch = `feature/${randomUUID().slice(0, 6)}`;
  const wt = r.worktree(branch, { "a.txt": "a\n" });
  const id = seedSession({
    projectId: project.id,
    name: "s",
    task: true,
    branch,
  });
  db.prepare(
    `UPDATE sessions SET worktree_path = ?, working_directory = ?, base_branch = 'main' WHERE id = ?`
  ).run(wt.dir, wt.dir, id);
  git(r.repo, "worktree", "remove", "--force", wt.dir);
  if (!branchExists) {
    git(r.repo, "branch", "-D", branch);
    git(r.repo, "push", "-q", "origin", "--delete", branch);
  }
  recordSwept(id, wt.dir, branch, 1);
  const row = () =>
    db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as Session;
  return { r, id, branch, dir: wt.dir, row };
}

describe("restoring a session whose worktree was swept", () => {
  it("recreates the worktree at its old path from the branch, and says so", async () => {
    const s = swept(true);
    expect(fs.existsSync(s.dir)).toBe(false);
    expect(sweptNote(s.id)).toMatch(/cleaned up on \d{4}-\d{2}-\d{2}/);
    const note = await restoreSwept(s.row());
    expect(note).toMatch(/cleaned up on .* and recreated from /);
    expect(fs.existsSync(`${s.dir}/a.txt`)).toBe(true);
    expect(git(s.dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe(s.branch);
    expect(s.row().worktree_path).toBe(s.dir);
    expect(sweptNote(s.id)).toBeNull();
  });

  it("says the worktree is gone when the branch is too, and keeps the conversation in the project", async () => {
    const s = swept(false);
    const note = await restoreSwept(s.row());
    expect(note).toMatch(
      /cleaned up on .* its branch is gone, so only the conversation came back/
    );
    expect(s.row().worktree_path).toBeNull();
    expect(s.row().working_directory).toBe(s.r.repo);
    expect(fs.existsSync(s.dir)).toBe(false);
  });

  it("says nothing about a session that was never swept", async () => {
    const r = makeRepo();
    const project = createProject({
      name: `app-${randomUUID().slice(0, 8)}`,
      workingDirectory: r.repo,
    });
    const id = seedSession({ projectId: project.id, name: "plain" });
    const row = db
      .prepare(`SELECT * FROM session_rows WHERE id = ?`)
      .get(id) as Session;
    expect(await restoreSwept(row)).toBeNull();
  });
});
