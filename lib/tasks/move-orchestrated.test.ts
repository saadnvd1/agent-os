import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const WT_ROOT = vi.hoisted(
  () =>
    `${process.env.TMPDIR || "/tmp"}/aos-orch-wt-${process.pid}-${Date.now()}`
);
vi.mock("../worktrees", async (orig) => ({
  ...(await orig<typeof import("../worktrees")>()),
  WORKTREES_DIR: WT_ROOT,
}));
vi.mock("../env-setup", () => ({ setupWorktree: vi.fn(async () => ({})) }));
vi.mock("../agents/launch", () => ({ launchClaude: vi.fn(async () => {}) }));

import { db, updateSessionRow } from "../db";
import { seedOrchestrator } from "../orchestrator/testing";
import { createHost } from "../hosts";
import { saveHostLink } from "../hosts/remote-api";
import { createWorkspace, setProjectWorkspace } from "../workspaces";
import { setPaused } from "../orchestrator/pause";
import { workspaceSessions } from "../orchestrator/facts";
import { armTask } from "../orchestrator/armed";
import { PLAN_FILE, preparePlanDir } from "../models/plan-step";
import { exportTask, markMoved } from "./move";
import { importTask } from "./import";
import { moveTask } from "./move-flow";
import { signOffTask } from "./finish";
import { holderRefusal } from "./held";
import { TASK_CAPABILITIES } from "./contract/types";
import {
  json,
  row,
  seedTask as seed,
  setupMoveRepo,
  type MoveFixture,
} from "./move-testing";

const fetchMock = vi.fn();
let f: MoveFixture;
let hostId: string;
let workspaceId: string;
const seedTask = (branch: string) => seed(f, WT_ROOT, branch);
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));
const PLAN = "# Plan\n- change the thing\n";

// An orchestrator's task: started by it, with its records and a plan.
async function orchestratedTask(branch: string) {
  const t = await seedTask(branch);
  seedOrchestrator("orch-1");
  updateSessionRow(db, t.id, {
    started_by: "orch-1",
    model_overrides: "anthropic/x",
    plan_decided: 1,
    plan_reason: "big",
    merge_armed_at: "then",
    pr_number: 7,
  });
  db.prepare(
    `INSERT INTO orchestrator_starts (workspace_id, kind, target, created_at) VALUES (?, 'task', ?, datetime('now'))`
  ).run(workspaceId, t.id);
  db.prepare(
    `INSERT INTO orchestrator_checks (workspace_id, session_id, sha, kind, status) VALUES (?, ?, 'abc', 'review', 'pass')`
  ).run(workspaceId, t.id);
  db.prepare(
    `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count) VALUES (?, 'ci', ?, 1)`
  ).run(t.id, workspaceId);
  db.prepare(
    `INSERT INTO brief_amendments (session_id, workspace_id, text) VALUES (?, ?, 'also do X')`
  ).run(t.id, workspaceId);
  preparePlanDir(t.cwd);
  fs.writeFileSync(path.join(t.cwd, PLAN_FILE), PLAN);
  return t;
}

const arrivedThere = (branch: string) => {
  const id = randomUUID();
  return {
    session: {
      id,
      name: "Fix it",
      tmux_name: `claude-${id}`,
      working_directory: "/home/alice/wt",
      worktree_path: "/home/alice/wt",
      model: "sonnet",
      branch_name: branch,
      base_branch: "main",
      task_prompt: "fix the thing",
    },
  };
};

// The box answers its task list, then the import.
function boxAnswers(branch: string, capabilities: readonly string[]) {
  const there = arrivedThere(branch);
  fetchMock.mockImplementation(async (url: string) =>
    String(url).endsWith("/api/tasks")
      ? json({ tasks: [], capabilities })
      : json(there, 201)
  );
  return there.session;
}

beforeAll(() => {
  f = setupMoveRepo();
  hostId = createHost("box", "alice@devbox").id;
  saveHostLink(hostId, "http://box:3011", "tok");
  workspaceId = createWorkspace("orch-moves").id;
  setProjectWorkspace(f.projectId, workspaceId);
  vi.stubGlobal("fetch", fetchMock);
});
afterAll(() => {
  vi.unstubAllGlobals();
  f.restore();
  fs.rmSync(WT_ROOT, { recursive: true, force: true });
});
beforeEach(() => {
  fetchMock.mockReset();
  setPaused(workspaceId, false);
});

describe("an orchestrator's task moving to a linked machine", () => {
  it("names its orchestrator to the machine it lands on, which keeps it for replies", async () => {
    const orch = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, role) VALUES (?, 'The Boss', ?, '/tmp', 'orchestrator')`
    ).run(orch, `claude-${orch}`);
    const { id } = await orchestratedTask("feature/o-reply");
    db.prepare(`UPDATE sessions SET started_by = ? WHERE id = ?`).run(orch, id);
    const bundle = await exportTask(id, "box");
    expect(bundle.orchestrated?.orchestrator).toEqual({
      id: orch,
      name: "The Boss",
    });
    markMoved(id, "box");
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    const task = await importTask(bundle, { holder: "dev-1" });
    expect(task).toMatchObject({ held_for: orch, held_for_name: "The Boss" });
    // Taken onward, it still names the same orchestrator.
    expect(
      (await exportTask(task.id, "mac")).orchestrated?.orchestrator
    ).toEqual({ id: orch, name: "The Boss" });
  });

  it("drops an orchestrator that isn't a session id", async () => {
    const bundle = await exportTask(
      (await orchestratedTask("feature/o-badorch")).id,
      "box"
    );
    bundle.orchestrated!.orchestrator = { id: "../x", name: "x" };
    const { validateBundle } = await import("./move-bundle");
    expect(validateBundle(bundle).orchestrated?.orchestrator).toBeUndefined();
  });

  it("moves, carrying its plan and settings, and keeps the orchestrator's records on the new id", async () => {
    const { id } = await orchestratedTask("feature/o-out");
    const there = boxAnswers("feature/o-out", TASK_CAPABILITIES);
    await moveTask(id, hostId);

    const sent = JSON.parse(
      fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/import"))![1]
        .body
    );
    expect(sent.orchestrated).toMatchObject({
      heldFrom: os.hostname().replace(/[^\w.@ -]/g, ""),
      modelOverrides: "anthropic/x",
      planFile: PLAN,
    });
    expect(sent.orchestrated.since).toMatch(/Z$/);

    expect(row(id).task_status).toBe("moved");
    const y = row(there.id);
    expect(y).toMatchObject({
      host_id: hostId,
      task_status: "running",
      started_by: "orch-1",
      model_overrides: "anthropic/x",
      plan_decided: 1,
      merge_armed_at: "then",
      pr_number: 7,
    });
    expect(y.task_since).toBeTruthy();
    const keyed = (sql: string, who: string) =>
      (db.prepare(sql).get(who) as { n: number }).n;
    for (const sql of [
      `SELECT COUNT(*) n FROM orchestrator_starts WHERE target = ?`,
      `SELECT COUNT(*) n FROM orchestrator_checks WHERE session_id = ?`,
      `SELECT COUNT(*) n FROM orchestrator_gate_failures WHERE session_id = ?`,
      `SELECT COUNT(*) n FROM brief_amendments WHERE session_id = ?`,
    ]) {
      expect(keyed(sql, there.id), sql).toBe(1);
      expect(keyed(sql, id), sql).toBe(0);
    }
    // Still the orchestrator's: the mirror is in its list, the moved row isn't.
    expect(workspaceSessions(workspaceId).map((s) => s.id)).toContain(there.id);
    expect(workspaceSessions(workspaceId).map((s) => s.id)).not.toContain(id);
  });

  it("is refused before anything moves when the machine can't hold it", async () => {
    const { id } = await orchestratedTask("feature/o-old");
    boxAnswers(
      "feature/o-old",
      TASK_CAPABILITIES.filter((c) => c !== "orchestrated-move")
    );
    await expect(moveTask(id, hostId)).rejects.toThrow(
      /can't move orchestrator tasks/
    );
    expect(urls().every((u) => u.endsWith("/api/tasks"))).toBe(true);
    expect(row(id).task_status).toBe("running");
  });

  it("is refused while the workspace is paused", async () => {
    const { id } = await orchestratedTask("feature/o-paused");
    setPaused(workspaceId, true);
    await expect(moveTask(id, hostId)).rejects.toThrow(/paused/);
    expect(fetchMock).not.toHaveBeenCalled();
    setPaused(workspaceId, false);
  });

  it("is refused with an open ask on the task, which asks name as task:<id>", async () => {
    const { id } = await orchestratedTask("feature/o-ask");
    db.prepare(
      `INSERT INTO orchestrator_asks (workspace_id, subject, kind, title) VALUES (?, ?, 'merge', 'ok?')`
    ).run(workspaceId, `task:${id}`);
    await expect(moveTask(id, hostId)).rejects.toThrow(/open ask/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries a task back with its records, and brings no hold with it", async () => {
    const { id } = await orchestratedTask("feature/o-back");
    const there = boxAnswers("feature/o-back", TASK_CAPABILITIES);
    await moveTask(id, hostId);
    const exported = JSON.parse(
      fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/import"))![1]
        .body
    );
    // The box's own export of it: the mirror's id, and what it was told.
    const bundle = { ...exported, moveId: there.id };
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/export")
        ? json({ bundle })
        : json({ success: true })
    );
    // While it comes back the mirror is moving, not a task to judge.
    const states: unknown[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      states.push(row(there.id)?.task_status);
      return String(url).endsWith("/export")
        ? json({ bundle })
        : json({ success: true });
    });
    const z = await moveTask(there.id, "local");
    expect(states[0]).toBe("moving");
    expect(row(there.id)).toBeUndefined();
    expect(z).toMatchObject({
      host_id: "local",
      task_status: "running",
      started_by: "orch-1",
      held_by_device: null,
    });
    const n = (
      db
        .prepare(
          `SELECT COUNT(*) n FROM orchestrator_checks WHERE session_id = ?`
        )
        .get(z.id) as { n: number }
    ).n;
    expect(n).toBe(1);
    expect(
      fs.readFileSync(path.join(z.working_directory, PLAN_FILE), "utf8")
    ).toBe(PLAN);
    expect(workspaceSessions(workspaceId).map((s) => s.id)).toContain(z.id);
  });
});

describe("the machine an orchestrator's task lands on", () => {
  // The bundle the Mac would send: exported from a real task, which is then
  // marked moved as the source does.
  async function bundleFor(branch: string) {
    const { id } = await orchestratedTask(branch);
    const bundle = await exportTask(id, "mac");
    markMoved(id, "mac");
    // The machine it lands on has never heard of the source's row.
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    return bundle;
  }

  it("holds it for the device that sent it, and the orchestrator's state doesn't come with it", async () => {
    const bundle = await bundleFor("feature/h-hold");
    const task = await importTask(bundle, { holder: "dev-1" });
    expect(task).toMatchObject({
      held_by_device: "dev-1",
      started_by: null,
      model_overrides: "anthropic/x",
      task_status: "running",
    });
    expect(task.held_from).toBeTruthy();
    expect(
      fs.readFileSync(path.join(task.working_directory, PLAN_FILE), "utf8")
    ).toBe(PLAN);
    // The peer's own orchestrator doesn't see it.
    expect(workspaceSessions(workspaceId).map((s) => s.id)).not.toContain(
      task.id
    );
    // A commit message here has its attribution stripped, like any worktree.
    const hooks = fs.readdirSync(
      path.join(
        (await import("../git-exec"))
          .gitSync(task.working_directory, ["rev-parse", "--absolute-git-dir"])
          .trim(),
        "agentos-hooks"
      )
    );
    expect(hooks).toContain("commit-msg");
  });

  it("refuses to merge, arm or move it for anyone but that device", async () => {
    const bundle = await bundleFor("feature/h-refuse");
    const task = await importTask(bundle, { holder: "dev-1" });
    expect(holderRefusal(task, "dev-2")).toMatch(/decides this/);
    expect(holderRefusal(task, null)).toMatch(/decides this/);
    expect(holderRefusal(task, "dev-1")).toBeNull();
    await expect(signOffTask(task.id)).rejects.toThrow(/decides this/);
    await expect(signOffTask(task.id, { device: "dev-2" })).rejects.toThrow(
      /decides this/
    );
    expect(() => armTask(task)).toThrow(/held for/);
    await expect(moveTask(task.id, hostId)).rejects.toThrow(/decides this/);
    // The holder is past the hold: it fails on the missing PR, not on that.
    await expect(signOffTask(task.id, { device: "dev-1" })).rejects.not.toThrow(
      /decides this/
    );
  });

  it("refuses an import with a provider it doesn't have, leaving no task", async () => {
    const bundle = await bundleFor("feature/h-provider");
    bundle.orchestrated!.modelProvider = "nowhere";
    await expect(importTask(bundle, { holder: "dev-1" })).rejects.toThrow(
      /No model provider/
    );
    expect(
      db
        .prepare(`SELECT COUNT(*) n FROM session_rows WHERE moved_from = ?`)
        .get(bundle.moveId)
    ).toEqual({ n: 0 });
  });

  it("an import without a held bundle is an ordinary task", async () => {
    const t = await seedTask("feature/h-plain");
    const bundle = await exportTask(t.id, "mac");
    markMoved(t.id, "mac");
    const task = await importTask(bundle, { holder: "dev-1" });
    expect(task.held_by_device).toBeNull();
  });
});
