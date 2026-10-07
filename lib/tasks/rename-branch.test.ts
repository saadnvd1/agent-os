import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { git, makeRepo } from "@/lib/done/testing";
import { seedTask, taskRow } from "./testing";

// No tmux here, and the test's worktrees aren't under ~/.agent-os.
vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  hostExec: async () => ({ stdout: "", stderr: "" }),
}));
vi.mock("@/lib/worktrees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/worktrees")>()),
  isAgentOSWorktree: () => true,
}));

const { PATCH } = await import("@/app/api/sessions/[id]/route");

const rename = (id: string, name: string) =>
  PATCH(
    new NextRequest(`http://127.0.0.1:3011/api/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
    { params: Promise.resolve({ id }) }
  );

// A worktree session that isn't a task.
function seedSession(repo: string, branch: string, worktree: string) {
  const s = seedTask(repo, branch, worktree);
  db.prepare(`UPDATE sessions SET task_status = NULL WHERE id = ?`).run(s.id);
  return s.id;
}

describe("renaming a session through the API", () => {
  it("never renames a task's branch", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/read-and-execute-the-brief-at-2582");
    const task = seedTask(
      r.repo,
      "feature/read-and-execute-the-brief-at-2582",
      wt.dir
    );

    const res = await rename(task.id, "Schedules: message a session + notify");
    expect(res.status).toBe(200);
    expect(git(wt.dir, "branch", "--show-current")).toBe(
      "feature/read-and-execute-the-brief-at-2582"
    );
    expect(taskRow(task.id)).toMatchObject({
      name: "Schedules: message a session + notify",
      branch_name: "feature/read-and-execute-the-brief-at-2582",
    });
  });

  it("renames an unpushed session branch and moves the row with it", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/session-3");
    const id = seedSession(r.repo, "feature/session-3", wt.dir);

    expect((await rename(id, "Try the new parser")).status).toBe(200);
    expect(git(wt.dir, "branch", "--show-current")).toBe(
      "feature/try-the-new-parser"
    );
    expect(taskRow(id).branch_name).toBe("feature/try-the-new-parser");
  });

  it("keeps a pushed branch's name, so its PR stays open", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/pushed", { "a.txt": "a\n" });
    const id = seedSession(r.repo, "feature/pushed", wt.dir);

    expect((await rename(id, "Something else")).status).toBe(200);
    expect(git(wt.dir, "branch", "--show-current")).toBe("feature/pushed");
    expect(git(r.repo, "ls-remote", "--heads", "origin")).toContain(
      "refs/heads/feature/pushed"
    );
    expect(taskRow(id)).toMatchObject({
      name: "Something else",
      branch_name: "feature/pushed",
    });
  });

  it("keeps the row's branch when git couldn't rename it", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/old-name");
    // The name the rename would pick is taken.
    git(r.repo, "branch", "feature/taken", "main");
    const id = seedSession(r.repo, "feature/old-name", wt.dir);

    expect((await rename(id, "Taken")).status).toBe(200);
    expect(git(wt.dir, "branch", "--show-current")).toBe("feature/old-name");
    expect(taskRow(id)).toMatchObject({
      name: "Taken",
      branch_name: "feature/old-name",
    });
  });
});
