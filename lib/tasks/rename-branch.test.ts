import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { db, type Session } from "@/lib/db";
import { createProject } from "@/lib/projects";
import { git, makeRepo } from "@/lib/done/testing";

// No tmux here, and the test's worktree isn't under ~/.agent-os.
vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  hostExec: async () => ({ stdout: "", stderr: "" }),
}));
vi.mock("@/lib/worktrees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/worktrees")>()),
  isAgentOSWorktree: () => true,
}));

const { PATCH } = await import("@/app/api/sessions/[id]/route");

function seedTask(repo: string, branch: string, worktree: string): string {
  const project = createProject({
    name: `p-${crypto.randomUUID().slice(0, 6)}`,
    workingDirectory: repo,
  });
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id,
       task_status, branch_name, worktree_path)
     VALUES (?, 'Read and execute the brief', ?, ?, ?, 'running', ?, ?)`
  ).run(id, `claude-${id}`, worktree, project.id, branch, worktree);
  return id;
}

const rename = (id: string, name: string) =>
  PATCH(
    new NextRequest(`http://127.0.0.1:3011/api/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
    { params: Promise.resolve({ id }) }
  );

describe("renaming a task through the API", () => {
  it("moves the row's branch with the git branch", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/read-and-execute-the-brief-at-2582");
    const id = seedTask(
      r.repo,
      "feature/read-and-execute-the-brief-at-2582",
      wt.dir
    );

    const res = await rename(id, "Schedules: message a session + notify");
    expect(res.status).toBe(200);

    expect(git(wt.dir, "branch", "--show-current")).toBe(
      "feature/schedules-message-a-session-notify"
    );
    const row = db
      .prepare(`SELECT branch_name FROM sessions WHERE id = ?`)
      .get(id) as Pick<Session, "branch_name">;
    expect(row.branch_name).toBe("feature/schedules-message-a-session-notify");
  });

  it("keeps the row's branch when git couldn't rename it", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/old-name");
    // The name the rename would pick is taken.
    git(r.repo, "branch", "feature/taken", "main");
    const id = seedTask(r.repo, "feature/old-name", wt.dir);

    expect((await rename(id, "Taken")).status).toBe(200);
    expect(git(wt.dir, "branch", "--show-current")).toBe("feature/old-name");
    const row = db
      .prepare(`SELECT name, branch_name FROM sessions WHERE id = ?`)
      .get(id) as Pick<Session, "name" | "branch_name">;
    expect(row).toEqual({ name: "Taken", branch_name: "feature/old-name" });
  });
});
