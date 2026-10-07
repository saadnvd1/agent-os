import fs from "fs";
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
    `${process.env.TMPDIR || "/tmp"}/aos-flow-wt-${process.pid}-${Date.now()}`
);
vi.mock("../worktrees", async (orig) => ({
  ...(await orig<typeof import("../worktrees")>()),
  WORKTREES_DIR: WT_ROOT,
}));
vi.mock("../env-setup", () => ({ setupWorktree: vi.fn(async () => ({})) }));
vi.mock("../agents/launch", () => ({ launchClaude: vi.fn(async () => {}) }));

import { db } from "../db";
import { createHost } from "../hosts";
import { saveHostLink } from "../hosts/remote-api";
import { launchClaude } from "../agents/launch";
import { exportTask, markMoved } from "./move";
import { moveTask } from "./move-flow";
import {
  CLAUDE_ID,
  json,
  row,
  seedTask as seed,
  setupMoveRepo,
  type MoveFixture,
} from "./move-testing";

const fetchMock = vi.fn();
let f: MoveFixture;
let hostId: string;
const seedTask = (branch: string) => seed(f, WT_ROOT, branch);
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeAll(() => {
  f = setupMoveRepo();
  hostId = createHost("box", "alice@box").id;
  saveHostLink(hostId, "http://box:3011", "tok");
  vi.stubGlobal("fetch", fetchMock);
});
afterAll(() => {
  vi.unstubAllGlobals();
  f.restore();
  fs.rmSync(WT_ROOT, { recursive: true, force: true });
});
beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(launchClaude).mockReset();
});

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

describe("moving a task to a linked machine", () => {
  it("hands the bundle over, mirrors the new task and marks this one moved", async () => {
    const { id } = await seedTask("feature/out");
    const there = arrivedThere("feature/out");
    fetchMock.mockResolvedValueOnce(json(there, 201));
    await moveTask(id, hostId);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://box:3011/api/tasks/import");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toMatchObject({
      moveId: id,
      branch: "feature/out",
    });
    expect(row(id)).toMatchObject({ task_status: "moved", moved_to: "box" });
    expect(row(there.session.id)).toMatchObject({
      host_id: hostId,
      task_status: "running",
      project_id: f.projectId,
    });
  });

  it("resumes the agent here when the other machine refuses", async () => {
    const { id } = await seedTask("feature/refused");
    fetchMock.mockResolvedValueOnce(json({ error: "disk full" }, 400));
    await expect(moveTask(id, hostId)).rejects.toThrow(/disk full/);
    expect(row(id).task_status).toBe("running");
    expect(vi.mocked(launchClaude).mock.calls.at(-1)![0]).toMatchObject({
      sessionId: id,
      resume: CLAUDE_ID,
    });
  });

  it("an unknown outcome leaves it moving (never running twice), and Move again finishes it", async () => {
    const { id } = await seedTask("feature/unknown");
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    await expect(moveTask(id, hostId)).rejects.toThrow(/press Move again/);
    expect(row(id).task_status).toBe("moving");
    expect(launchClaude).not.toHaveBeenCalled();
    // Retried once with the same move id before giving up.
    expect(urls()).toEqual([
      "http://box:3011/api/tasks/import",
      "http://box:3011/api/tasks/import",
    ]);

    fetchMock.mockReset();
    const there = arrivedThere("feature/unknown");
    fetchMock.mockResolvedValueOnce(json(there, 201));
    await moveTask(id, hostId);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).moveId).toBe(id);
    expect(row(id).task_status).toBe("moved");
    expect(launchClaude).not.toHaveBeenCalled();
  });
});

describe("moving a task back from a linked machine", () => {
  // A task on the box: its mirror here, and the bundle the box would export.
  async function onTheBox(branch: string) {
    const { id: leftHere } = await seedTask(branch);
    const bundle = await exportTask(leftHere, "box");
    markMoved(leftHere, "box");
    const mirrorId = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id, task_status, branch_name, host_id)
       VALUES (?, 'Fix it', ?, '/home/alice/wt', ?, 'running', ?, ?)`
    ).run(mirrorId, `claude-${mirrorId}`, f.projectId, branch, hostId);
    return { mirrorId, bundle: { ...bundle, moveId: mirrorId } };
  }

  it("exports there, resumes here, and tells that machine it moved", async () => {
    const { mirrorId, bundle } = await onTheBox("feature/in");
    fetchMock
      .mockResolvedValueOnce(json({ bundle }))
      .mockResolvedValueOnce(json({ success: true }));
    const arrived = await moveTask(mirrorId, "local");
    expect(urls()).toEqual([
      `http://box:3011/api/tasks/${mirrorId}/export`,
      `http://box:3011/api/tasks/${mirrorId}/moved`,
    ]);
    expect(arrived).toMatchObject({
      host_id: "local",
      task_status: "running",
      moved_from: mirrorId,
    });
    expect(row(mirrorId).task_status).toBe("moved");
  });

  it("asks that machine to resume it when it can't start here", async () => {
    const { mirrorId, bundle } = await onTheBox("feature/in-fails");
    vi.mocked(launchClaude).mockRejectedValueOnce(new Error("no tmux"));
    fetchMock
      .mockResolvedValueOnce(json({ bundle }))
      .mockResolvedValueOnce(json({ success: true }));
    await expect(moveTask(mirrorId, "local")).rejects.toThrow(/no tmux/);
    expect(urls()[1]).toBe(`http://box:3011/api/tasks/${mirrorId}/resume`);
    expect(urls()).not.toContain(`http://box:3011/api/tasks/${mirrorId}/moved`);
    expect(row(mirrorId).task_status).toBe("running");
  });

  it("keeps the mirror when that machine doesn't confirm, and Move here again tidies up", async () => {
    const { mirrorId, bundle } = await onTheBox("feature/in-unconfirmed");
    fetchMock
      .mockResolvedValueOnce(json({ bundle }))
      .mockRejectedValue(new Error("socket hang up"));
    await expect(moveTask(mirrorId, "local")).rejects.toThrow(
      /running here now/
    );
    expect(row(mirrorId).task_status).toBe("running");
    expect(launchClaude).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(json({ bundle }))
      .mockResolvedValueOnce(json({ success: true }));
    await moveTask(mirrorId, "local");
    expect(row(mirrorId).task_status).toBe("moved");
    // The second import found the first arrival instead of starting another.
    expect(launchClaude).toHaveBeenCalledTimes(1);
  });
});
