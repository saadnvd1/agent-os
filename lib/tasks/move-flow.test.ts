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
import { resumeHere } from "./move-recover";
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
    fetchMock
      .mockResolvedValueOnce(json({ session: null }))
      .mockResolvedValueOnce(json(there, 201));
    await moveTask(id, hostId);
    // Asked first whether the earlier try arrived, then moved it again.
    expect(urls()[0]).toBe(`http://box:3011/api/tasks/arrived?from=${id}`);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).moveId).toBe(id);
    expect(row(id).task_status).toBe("moved");
    expect(launchClaude).not.toHaveBeenCalled();
  });

  it("a retry finds the earlier try arrived and only settles it", async () => {
    const { id } = await seedTask("feature/arrived-before");
    fetchMock.mockRejectedValue(new Error("timeout"));
    await expect(moveTask(id, hostId)).rejects.toThrow(/press Move again/);
    fetchMock.mockReset();
    const there = arrivedThere("feature/arrived-before");
    fetchMock.mockResolvedValueOnce(json(there));
    await moveTask(id, hostId);
    expect(urls()).toEqual([`http://box:3011/api/tasks/arrived?from=${id}`]);
    expect(row(id).task_status).toBe("moved");
    expect(row(there.session.id).host_id).toBe(hostId);
  });

  it.each([
    ["a proxy error page", new Response("<html>502</html>", { status: 502 })],
    ["a 404 with no AgentOS error", new Response("{}", { status: 404 })],
    ["a 200 that isn't JSON", new Response("<html>ok</html>")],
    ["an import still in progress", json({ error: "arriving" }, 503)],
  ])("treats %s as an unknown outcome, never a refusal", async (_, res) => {
    const { id } = await seedTask(`feature/odd-${randomUUID().slice(0, 6)}`);
    fetchMock.mockImplementation(async () => res.clone());
    await expect(moveTask(id, hostId)).rejects.toThrow(/press Move again/);
    expect(row(id).task_status).toBe("moving");
    expect(launchClaude).not.toHaveBeenCalled();
  });

  it("won't retry a half-finished move to a different machine", async () => {
    const { id } = await seedTask("feature/other-target");
    fetchMock.mockRejectedValue(new Error("timeout"));
    await expect(moveTask(id, hostId)).rejects.toThrow(/press Move again/);
    const other = createHost("box2", "alice@box2").id;
    saveHostLink(other, "http://box2:3011", "tok2");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(json({ session: null }));
    await expect(moveTask(id, other)).rejects.toThrow(
      /partway through moving to box/
    );
    expect(urls().some((u) => u.includes("box2:3011/api/tasks/import"))).toBe(
      false
    );
  });

  it("refuses a task that's with Saad, on a card, or finished, before touching it", async () => {
    const { id } = await seedTask("feature/held");
    db.prepare(
      `INSERT INTO orchestrator_asks (workspace_id, subject, kind, title) VALUES ('w', ?, 'merge', 'ok?')`
    ).run(id);
    await expect(moveTask(id, hostId)).rejects.toThrow(/open ask/);
    const card = await seedTask("feature/carded");
    db.prepare(`UPDATE sessions SET lh_card_id = 'c1' WHERE id = ?`).run(
      card.id
    );
    await expect(moveTask(card.id, hostId)).rejects.toThrow(/Card tasks/);
    db.prepare(`UPDATE sessions SET task_status = 'merged' WHERE id = ?`).run(
      card.id
    );
    await expect(moveTask(card.id, hostId)).rejects.toThrow(/already merged/);
    await expect(moveTask(id, "local")).rejects.toThrow(
      /already on this machine/
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(id).task_status).toBe("running");
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
    // It definitely didn't arrive here, so that machine resumes without asking.
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      force: true,
    });
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
    fetchMock.mockResolvedValueOnce(json({ success: true }));
    await moveTask(mirrorId, "local");
    // It had arrived: no second export, only the confirmation.
    expect(urls()).toEqual([`http://box:3011/api/tasks/${mirrorId}/moved`]);
    expect(row(mirrorId).task_status).toBe("moved");
    expect(launchClaude).toHaveBeenCalledTimes(1);
  });

  it("an unknown export outcome there leaves everything as it was", async () => {
    const { mirrorId } = await onTheBox("feature/in-unknown");
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    await expect(moveTask(mirrorId, "local")).rejects.toThrow(
      /press Move again/
    );
    expect(row(mirrorId).task_status).toBe("running");
    expect(launchClaude).not.toHaveBeenCalled();
  });
});

describe("a task stuck moving", () => {
  async function stuck(branch: string) {
    const { id } = await seedTask(branch);
    fetchMock.mockRejectedValue(new Error("timeout"));
    await expect(moveTask(id, hostId)).rejects.toThrow(/press Move again/);
    fetchMock.mockReset();
    return id;
  }

  it("Resume here asks the other machine first, and settles it there if it arrived", async () => {
    const id = await stuck("feature/stuck-arrived");
    const there = arrivedThere("feature/stuck-arrived");
    fetchMock.mockResolvedValueOnce(json(there));
    await expect(resumeHere(id)).resolves.toEqual({
      resumed: false,
      movedTo: "box",
    });
    expect(row(id).task_status).toBe("moved");
    expect(launchClaude).not.toHaveBeenCalled();
  });

  it("resumes here when it didn't arrive there", async () => {
    const id = await stuck("feature/stuck-not");
    fetchMock.mockResolvedValueOnce(json({ session: null }));
    await expect(resumeHere(id)).resolves.toEqual({ resumed: true });
    expect(row(id)).toMatchObject({ task_status: "running", moved_to: null });
    expect(launchClaude).toHaveBeenCalledTimes(1);
  });

  it("won't guess when it can't ask; forcing is the user's call", async () => {
    const id = await stuck("feature/stuck-gone");
    fetchMock.mockRejectedValue(new Error("unreachable"));
    await expect(resumeHere(id)).rejects.toThrow(/Resume anyway/);
    expect(row(id).task_status).toBe("moving");
    await expect(resumeHere(id, true)).resolves.toEqual({ resumed: true });
    expect(row(id).task_status).toBe("running");
  });

  it("a repeated resume leaves the running agent alone", async () => {
    const id = await stuck("feature/stuck-twice");
    await resumeHere(id, true);
    await resumeHere(id, true);
    expect(launchClaude).toHaveBeenCalledTimes(1);
  });
});
