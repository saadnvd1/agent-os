import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const WT_ROOT = vi.hoisted(
  () =>
    `${process.env.TMPDIR || "/tmp"}/aos-away-wt-${process.pid}-${Date.now()}`
);
vi.mock("../worktrees", async (orig) => ({
  ...(await orig<typeof import("../worktrees")>()),
  WORKTREES_DIR: WT_ROOT,
  isAgentOSWorktree: () => true,
}));
vi.mock("../env-setup", () => ({ setupWorktree: vi.fn(async () => ({})) }));
const ended = vi.hoisted(() => [] as string[]);
vi.mock("../sessions/end", () => ({
  endSessionAgent: async (s: { id: string }) => {
    ended.push(s.id);
  },
}));
vi.mock("../async-operations", () => ({
  runInBackground: (task: () => Promise<void>) => void task(),
}));

import { db, insertSessionRow, updateSessionRow } from "../db";
import { DEVICE_HEADER } from "../security/auth";
import { cleanUpMovedAway } from "./moved-away";
import { POST as moved } from "@/app/api/tasks/[id]/moved/route";
import {
  git,
  seedTask as seed,
  setupMoveRepo,
  type MoveFixture,
} from "./move-testing";

let f: MoveFixture;
beforeAll(() => {
  f = setupMoveRepo();
});
afterAll(() => {
  f.restore();
  fs.rmSync(WT_ROOT, { recursive: true, force: true });
});

// A held task whose work went back to the machine that sent it.
async function away(branch: string) {
  const t = await seed(f, WT_ROOT, branch);
  updateSessionRow(db, t.id, {
    task_status: "moved",
    held_by_device: "dev-1",
    held_from: "mac",
  });
  return t;
}
// Its work committed and on a remote, as a move leaves it.
const pushed = (cwd: string, branch: string) => {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "work");
  git(cwd, "push", "-q", "-u", "origin", `HEAD:refs/heads/${branch}`);
};
const archived = (id: string) =>
  (
    db.prepare(`SELECT archived_at FROM sessions WHERE id = ?`).get(id) as {
      archived_at: string | null;
    }
  ).archived_at;

describe("a held task that went back", () => {
  it("stops its agent, removes a worktree with nothing to lose, and is archived", async () => {
    const t = await away("feature/away-clean");
    pushed(t.cwd, "feature/away-clean");
    const fate = await cleanUpMovedAway(t.id);
    expect(fate.action).toBe("removed");
    expect(fs.existsSync(t.cwd)).toBe(false);
    expect(ended).toContain(t.id);
    expect(archived(t.id)).toBeTruthy();
  });

  it("keeps a worktree with an uncommitted change", async () => {
    const t = await away("feature/away-dirty");
    pushed(t.cwd, "feature/away-dirty");
    fs.writeFileSync(path.join(t.cwd, "wip.txt"), "unsaved");
    const fate = await cleanUpMovedAway(t.id);
    expect(fate).toMatchObject({ action: "kept" });
    expect(fs.existsSync(t.cwd)).toBe(true);
  });

  it("keeps a worktree with a commit no remote has", async () => {
    const t = await away("feature/away-unpushed");
    git(t.cwd, "add", "-A");
    git(t.cwd, "commit", "-q", "-m", "unpushed");
    const fate = await cleanUpMovedAway(t.id);
    expect(fate).toMatchObject({ action: "kept" });
    expect((fate as { why: string }).why).toMatch(/no remote has/);
    expect(fs.existsSync(t.cwd)).toBe(true);
  });

  it("leaves a task that isn't a held, moved one alone", async () => {
    const t = await seed(f, WT_ROOT, "feature/away-plain");
    expect(await cleanUpMovedAway(t.id)).toEqual({ action: "none" });
    expect(fs.existsSync(t.cwd)).toBe(true);
  });
});

describe("POST /api/tasks/:id/moved on a held task", () => {
  const call = (id: string, device: string) =>
    moved(
      new NextRequest(`http://x/api/tasks/${id}/moved`, {
        method: "POST",
        headers: { [DEVICE_HEADER]: device },
        body: JSON.stringify({ to: "mac" }),
      }),
      { params: Promise.resolve({ id }) }
    );

  it("tidies up for the holder, and does nothing for another device", async () => {
    const t = await seed(f, WT_ROOT, "feature/away-route");
    pushed(t.cwd, "feature/away-route");
    updateSessionRow(db, t.id, { held_by_device: "dev-1", held_from: "mac" });
    expect((await call(t.id, "dev-2")).status).toBe(403);
    expect(fs.existsSync(t.cwd)).toBe(true);
    expect((await call(t.id, "dev-1")).status).toBe(200);
    await vi.waitFor(() => expect(fs.existsSync(t.cwd)).toBe(false));
    expect(
      (
        db
          .prepare(`SELECT task_status FROM session_rows WHERE id = ?`)
          .get(t.id) as {
          task_status: string;
        }
      ).task_status
    ).toBe("moved");
  });
});
