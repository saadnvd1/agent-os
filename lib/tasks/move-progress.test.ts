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
    `${process.env.TMPDIR || "/tmp"}/aos-prog-wt-${process.pid}-${Date.now()}`
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
import { exportTask, markMoved } from "./move";
import { moveTask } from "./move-flow";
import { getProgress } from "./move-progress";
import {
  json,
  row,
  seedTask,
  setupMoveRepo,
  type MoveFixture,
} from "./move-testing";

const fetchMock = vi.fn();
let f: MoveFixture;
let hostId: string;

beforeAll(() => {
  f = setupMoveRepo();
  hostId = createHost("box", "alice@devbox").id;
  saveHostLink(hostId, "http://box:3011", "tok");
  vi.stubGlobal("fetch", fetchMock);
});
afterAll(() => {
  vi.unstubAllGlobals();
  f.restore();
  fs.rmSync(WT_ROOT, { recursive: true, force: true });
});
beforeEach(() => fetchMock.mockReset());

const states = (id: string) =>
  getProgress(id)?.steps.map((s) => `${s.key}:${s.state}`);

describe("a move's progress", () => {
  it("walks every step to done when it lands", async () => {
    const { id } = await seedTask(f, WT_ROOT, "feature/prog-ok");
    const there = randomUUID();
    fetchMock.mockResolvedValueOnce(
      json(
        {
          session: {
            id: there,
            name: "Fix it",
            tmux_name: `claude-${there}`,
            working_directory: "/home/alice/wt",
            branch_name: "feature/prog-ok",
          },
        },
        201
      )
    );
    await moveTask(id, hostId);
    expect(getProgress(id)).toMatchObject({
      to: "box",
      finished: true,
      error: null,
    });
    expect(states(id)).toEqual([
      "save:done",
      "push:done",
      "conversation:done",
      "arrive:done",
    ]);
  });

  it("a refused move fails at the step it reached and leaves the task running here", async () => {
    const { id } = await seedTask(f, WT_ROOT, "feature/prog-refused");
    fetchMock.mockResolvedValueOnce(json({ error: "disk full" }, 400));
    await expect(moveTask(id, hostId)).rejects.toThrow(/disk full/);
    expect(getProgress(id)).toMatchObject({
      finished: true,
      error: "box: disk full",
    });
    expect(states(id)).toEqual([
      "save:done",
      "push:done",
      "conversation:done",
      "arrive:failed",
    ]);
    expect(row(id)).toMatchObject({ task_status: "running", moved_to: null });
  });

  it("a second press while one runs is refused without touching the first", async () => {
    const { id } = await seedTask(f, WT_ROOT, "feature/prog-twice");
    let land: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (land = r)));
    const first = moveTask(id, hostId);
    await vi.waitFor(() => expect(states(id)).toContain("arrive:active"));
    await expect(moveTask(id, hostId)).rejects.toThrow(/already moving/);
    expect(getProgress(id)?.error).toBeNull();
    land(json({ error: "no" }, 400));
    await expect(first).rejects.toThrow(/box: no$/);
    expect(row(id).task_status).toBe("running");
  });

  it("refuses an orchestrator's task before touching it", async () => {
    const { id } = await seedTask(f, WT_ROOT, "feature/prog-orch");
    db.prepare(
      `INSERT INTO orchestrator_starts (workspace_id, kind, target, created_at) VALUES ('w', 'task', ?, datetime('now'))`
    ).run(id);
    await expect(moveTask(id, hostId)).rejects.toThrow(/orchestrator's tasks/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(id).task_status).toBe("running");
  });
});

describe("a move back here's progress", () => {
  // A task on the box: its mirror here, and the bundle the box would export.
  async function onTheBox(branch: string) {
    const { id: leftHere } = await seedTask(f, WT_ROOT, branch);
    const bundle = await exportTask(leftHere, "box");
    markMoved(leftHere, "box");
    const mirrorId = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id, task_status, branch_name, host_id)
       VALUES (?, 'Fix it', ?, '/home/alice/wt', ?, 'running', ?, ?)`
    ).run(mirrorId, `claude-${mirrorId}`, f.projectId, branch, hostId);
    return { mirrorId, bundle: { ...bundle, moveId: mirrorId } };
  }

  it("reports the arriving half's steps under the mirror", async () => {
    const { mirrorId, bundle } = await onTheBox("feature/prog-in");
    fetchMock
      .mockResolvedValueOnce(json({ bundle }))
      .mockResolvedValueOnce(json({ success: true }));
    await moveTask(mirrorId, "local");
    expect(getProgress(mirrorId)).toMatchObject({
      finished: true,
      error: null,
    });
    expect(states(mirrorId)).toEqual([
      "export:done",
      "worktree:done",
      "conversation:done",
      "resume:done",
      "confirm:done",
    ]);
  });

  it("a refused export fails at the first step and leaves the mirror running", async () => {
    const { mirrorId } = await onTheBox("feature/prog-in-refused");
    fetchMock.mockResolvedValueOnce(json({ error: "busy" }, 400));
    await expect(moveTask(mirrorId, "local")).rejects.toThrow(/busy/);
    expect(states(mirrorId)?.[0]).toBe("export:failed");
    expect(
      states(mirrorId)
        ?.slice(1)
        .every((s) => s.endsWith(":pending"))
    ).toBe(true);
    expect(row(mirrorId)).toMatchObject({
      task_status: "running",
      host_id: hostId,
    });
  });
});
