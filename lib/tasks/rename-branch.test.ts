import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { git, makeRepo } from "@/lib/done/testing";
import type { FindPROpts } from "./gh";
import {
  fakeFindPR,
  fakePR,
  LONG_AGO,
  seedTask,
  taskRow,
  type FakePR,
} from "./testing";

const prs = new Map<string, FakePR>();
const lookups: ({ branch: string } & FindPROpts)[] = [];

// No tmux here, and the test's worktrees aren't under ~/.agent-os.
vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  hostExec: async () => ({ stdout: "", stderr: "" }),
}));
vi.mock("@/lib/worktrees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/worktrees")>()),
  isAgentOSWorktree: () => true,
}));
vi.mock("./gh", async (importOriginal) => {
  const find = fakeFindPR(prs, lookups);
  return {
    ...(await importOriginal<typeof import("./gh")>()),
    findPR: find,
    findPRStrict: find,
  };
});

const { PATCH } = await import("@/app/api/sessions/[id]/route");
const { prFor } = await import("./session");

const rename = (id: string, name: string) =>
  PATCH(
    new NextRequest(`http://127.0.0.1:3011/api/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
    { params: Promise.resolve({ id }) }
  );

beforeEach(() => {
  prs.clear();
  lookups.length = 0;
});

describe("renaming a task through the API", () => {
  it("moves the row's branch with the git branch, and finds its PR at once", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/read-and-execute-the-brief-at-2582");
    const task = seedTask(
      r.repo,
      "feature/read-and-execute-the-brief-at-2582",
      wt.dir
    );
    // A poll before the rename caches "no PR" for the old branch.
    expect(await prFor(task)).toBeNull();

    const res = await rename(task.id, "Schedules: message a session + notify");
    expect(res.status).toBe(200);
    expect(git(wt.dir, "branch", "--show-current")).toBe(
      "feature/schedules-message-a-session-notify"
    );
    expect(taskRow(task.id).branch_name).toBe(
      "feature/schedules-message-a-session-notify"
    );

    // The cached answer was for the old branch: the next poll asks again.
    prs.set("feature/schedules-message-a-session-notify", fakePR(114));
    expect((await prFor(taskRow(task.id)))?.number).toBe(114);
  });

  it("doesn't link a PR the new name had before the task", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/old-name");
    const task = seedTask(r.repo, "feature/old-name", wt.dir);
    prs.set("feature/fix-login-bug", fakePR(12, "MERGED", LONG_AGO));

    await rename(task.id, "Fix login bug");
    expect(taskRow(task.id).branch_name).toBe("feature/fix-login-bug");
    expect(await prFor(taskRow(task.id), true)).toBeNull();
    expect(await prFor(taskRow(task.id), true)).toBeNull();
    expect(taskRow(task.id).pr_number).toBeNull();
  });

  it("keeps the row's branch when git couldn't rename it", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/old-name");
    // The name the rename would pick is taken.
    git(r.repo, "branch", "feature/taken", "main");
    const task = seedTask(r.repo, "feature/old-name", wt.dir);

    expect((await rename(task.id, "Taken")).status).toBe(200);
    expect(git(wt.dir, "branch", "--show-current")).toBe("feature/old-name");
    expect(taskRow(task.id)).toMatchObject({
      name: "Taken",
      branch_name: "feature/old-name",
    });
  });
});
