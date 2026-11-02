import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "@/lib/test-temp";

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

let repo = "";

vi.mock("@/lib/chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/runner")>()),
  sendChat: async () => {},
  stopChat: () => {},
  chatState: () => null,
}));
vi.mock("@/lib/orchestrator/facts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/facts")>()),
  statusOf: async () => ({ status: "idle", activity: null, needsInput: false }),
}));
vi.mock("@/lib/sessions/launch", async () => {
  const { db, insertSessionRow } = await import("@/lib/db");
  return {
    launchSession: async (input: {
      id: string;
      projectId: string;
      name: string;
      parentSessionId: string;
      workingDirectory: string;
    }) => {
      insertSessionRow(db, {
        id: input.id,
        name: input.name,
        tmux_name: `claude-${input.id}`,
        working_directory: input.workingDirectory,
        project_id: input.projectId,
        view: "chat",
        parent_session_id: input.parentSessionId,
      });
      return { session: { id: input.id } };
    },
  };
});
// The real worktree and base snapshot, without the package setup.
vi.mock("@/lib/fork/worktree", async () => {
  const s = await import("@/lib/fork/scratch");
  const fs = await import("fs");
  return {
    createForkWorktree: async ({ childId }: { childId: string }) => {
      const wt = s.worktreeOf(childId);
      fs.mkdirSync(s.forkHome(childId), { recursive: true });
      sh(repo, "worktree", "add", "--detach", "--", wt, "HEAD");
      fs.writeFileSync(s.baseOf(childId), await s.snapshotTree(wt, childId));
      return { cwd: wt, root: wt, linked: false, head: "x" };
    },
  };
});
vi.mock("@/lib/fork/conversation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fork/conversation")>()),
  forkConversation: async () => ({ claudeSessionId: "forked-1", cut: "m9" }),
}));

const { db } = await import("@/lib/db");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { createProject } = await import("@/lib/projects");
const { setExperiment } = await import("@/lib/experiments");
const { startFork, admitQueued } = await import("./start");
const { returnChild, cancelChildren } = await import("./settle");
const ledger = await import("./ledger");
const scratch = await import("./scratch");

const flush = () => new Promise((r) => setTimeout(r, 50));

function setup() {
  repo = fs.realpathSync(tempDir("aos-fork-keep-"));
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.email", "t@example.com");
  sh(repo, "config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  fs.writeFileSync(path.join(repo, "b.txt"), "parent\n");
  sh(repo, "add", ".");
  sh(repo, "commit", "-qm", "init");
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: repo,
  });
  const parentId = seedSession({
    projectId: project.id,
    name: "parent",
    view: "chat",
  });
  db.prepare(
    `UPDATE sessions SET agent_type = 'claude', claude_session_id = 'pc', working_directory = ? WHERE id = ?`
  ).run(repo, parentId);
  return parentId;
}

async function child(worktree: boolean) {
  const parentId = setup();
  startFork({
    parentId,
    requestId: randomUUID(),
    instructions: ["do it"],
    startedBy: "agent",
    worktree,
  });
  await admitQueued(parentId);
  const id = ledger.childrenOf(parentId)[0].child_session_id;
  for (let i = 0; i < 100 && ledger.getChild(id)?.state === "starting"; i++)
    await flush();
  expect(ledger.getChild(id)?.state).toBe("running");
  return { parentId, id };
}

beforeEach(() => setExperiment("forks", true));

describe("what a fork wrote survives", () => {
  it("keeps scratch files after the child returns, and says where", async () => {
    const { id } = await child(false);
    fs.writeFileSync(path.join(scratch.scratchOf(id), "notes.md"), "mine");
    await returnChild(id, "done\n\nbody", false);
    expect(
      fs.readFileSync(path.join(scratch.scratchOf(id), "notes.md"), "utf8")
    ).toBe("mine");
    expect(ledger.getChild(id)?.result).toContain(scratch.scratchOf(id));
  });

  it("keeps a cancelled worktree child's edits, as a patch holding only its changes", async () => {
    const { parentId, id } = await child(true);
    // The parent's own change after the fork started must not be in it.
    fs.writeFileSync(path.join(repo, "b.txt"), "parent edit\n");
    const wt = scratch.worktreeOf(id);
    fs.writeFileSync(path.join(wt, "a.txt"), "two\n");
    fs.writeFileSync(path.join(wt, "new.txt"), "n\n");
    await cancelChildren(parentId);
    expect(fs.readFileSync(path.join(wt, "a.txt"), "utf8")).toBe("two\n");
    const patch = fs.readFileSync(
      path.join(scratch.forksRoot(), `${id}.patch`),
      "utf8"
    );
    expect(patch).toContain("new.txt");
    expect(patch).not.toContain("b.txt");
    fs.writeFileSync(path.join(scratch.forksRoot(), "x.patch"), patch);
    sh(repo, "apply", "--check", path.join(scratch.forksRoot(), "x.patch"));
  });

  it("survives the parent resetting and cleaning its checkout", async () => {
    const { id } = await child(true);
    const wt = scratch.worktreeOf(id);
    fs.writeFileSync(path.join(wt, "a.txt"), "two\n");
    fs.writeFileSync(path.join(scratch.scratchOf(id), "s.txt"), "s");
    sh(repo, "reset", "--hard");
    sh(repo, "clean", "-fdx", "-e", ".agent-os");
    await returnChild(id, "done", false);
    expect(fs.existsSync(path.join(wt, "a.txt"))).toBe(true);
    expect(fs.existsSync(path.join(scratch.scratchOf(id), "s.txt"))).toBe(true);
  });
});

describe("tidying up after a closed child", () => {
  it("keeps a home with work in it, removes an untouched one, spares patches", async () => {
    const dirty = await child(true);
    fs.writeFileSync(path.join(scratch.worktreeOf(dirty.id), "a.txt"), "x\n");
    const clean = await child(true);
    fs.writeFileSync(path.join(scratch.forksRoot(), "keep.patch"), "p");
    expect(await scratch.forkLosses(clean.id)).toEqual([]);
    const out = await scratch.sweepForks(() => false);
    expect(out.removed).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(scratch.forkHome(dirty.id))).toBe(true);
    expect(fs.existsSync(scratch.forkHome(clean.id))).toBe(false);
    expect(fs.existsSync(path.join(scratch.forksRoot(), "keep.patch"))).toBe(
      true
    );
  });

  it("removes a dirty home only when asked", async () => {
    const { id } = await child(false);
    fs.writeFileSync(path.join(scratch.scratchOf(id), "s.txt"), "s");
    expect(await scratch.tidyFork(id)).toBe(false);
    await scratch.removeFork(id);
    expect(fs.existsSync(scratch.forkHome(id))).toBe(false);
  });
});
