// The places a session ends drop its private database, while its row is
// still there to name it. gh, git, tmux and Postgres are faked.
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const drops: { id: string; rowThere: boolean }[] = [];

vi.mock("@/lib/tasks/gh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks/gh")>()),
  run: async () => "",
  findPR: async () => null,
  findPRStrict: async () => null,
}));
vi.mock("@/lib/worktrees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/worktrees")>()),
  deleteWorktree: async () => {},
}));
vi.mock("@/lib/lumifyhub/task-cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lumifyhub/task-cards")>()),
  syncTaskCardInBackground: () => {},
}));
vi.mock("@/lib/chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/runner")>()),
  stopChat: () => {},
}));
vi.mock("@/lib/project-config/database", async (importOriginal) => {
  const { db } = await import("@/lib/db");
  return {
    ...(await importOriginal<typeof import("@/lib/project-config/database")>()),
    dropSessionDatabase: async (id: string) => {
      drops.push({
        id,
        rowThere: !!db.prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(id),
      });
    },
  };
});

const { seedTask } = await import("./testing");
const { dropTask } = await import("./finish");
const { DELETE } = await import("@/app/api/sessions/[id]/route");

const task = () => {
  const repo = mkdtempSync(join(tmpdir(), "aos-db-drops-"));
  return seedTask(repo, `feature/${crypto.randomUUID().slice(0, 6)}`, repo);
};

beforeEach(() => {
  drops.length = 0;
});

describe("ending a session drops its database", () => {
  it("dropping a task", async () => {
    const s = task();
    await dropTask(s.id);
    expect(drops).toEqual([{ id: s.id, rowThere: true }]);
  });

  it("deleting a session, with its row read before it goes", async () => {
    const s = task();
    const res = await DELETE(
      new NextRequest(`http://127.0.0.1:3011/api/sessions/${s.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: s.id }) }
    );
    expect(res.status).toBe(200);
    expect(drops).toEqual([{ id: s.id, rowThere: true }]);
  });
});
