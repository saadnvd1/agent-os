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
import { db, type Session } from "../db";
import { createHost } from "../hosts";
import { saveHostLink } from "../hosts/remote-api";
import { createTask, dropTask, listTasks, signOffTask } from "./index";
import { forgetHostTasks, TASK_CAPABILITIES } from "./remote";
import { json, row, setupMoveRepo, type MoveFixture } from "./move-testing";

const fetchMock = vi.fn();
let f: MoveFixture;
let hostId: string;

function remoteSession(id = randomUUID()): Partial<Session> {
  return {
    id,
    name: "On the box",
    tmux_name: `claude-${id}`,
    working_directory: "/home/alice/.agent-os/worktrees/app-x",
    worktree_path: "/home/alice/.agent-os/worktrees/app-x",
    model: "sonnet",
    branch_name: "feature/x",
    base_branch: "main",
    task_prompt: "do x",
  };
}

const list = (tasks: unknown[], extra: object = {}) =>
  json({ tasks, moved: [], capabilities: [...TASK_CAPABILITIES], ...extra });
const view = (r: Partial<Session>, state: string) => ({
  id: r.id,
  name: r.name,
  state,
  createdAt: "2026-10-07 10:00:00",
});

async function startOne(): Promise<Partial<Session>> {
  const r = remoteSession();
  fetchMock.mockResolvedValueOnce(json({ session: r }, 201));
  await createTask({ projectId: f.projectId, prompt: "do x", hostId });
  return r;
}

beforeAll(() => {
  f = setupMoveRepo();
  hostId = createHost("devbox", "alice@devbox").id;
  saveHostLink(hostId, "http://devbox:3011", "secret-token");
  vi.stubGlobal("fetch", fetchMock);
});
afterAll(() => {
  vi.unstubAllGlobals();
  f.restore();
});
beforeEach(() => {
  fetchMock.mockReset();
  forgetHostTasks(hostId);
});

describe("starting a task on a linked machine", () => {
  it("starts it there under this machine's id and mirrors it here", async () => {
    const r = await startOne();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://devbox:3011/api/tasks");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      prompt: "do x",
      project: { name: "app", path: "dev/app", remote: f.origin },
    });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.projectId).toBeUndefined();
    expect(row(r.id!)).toMatchObject({
      host_id: hostId,
      project_id: f.projectId,
      tmux_name: r.tmux_name,
      task_status: "running",
    });
  });

  it("asks once more with the same id when it can't tell whether it started", async () => {
    const r = remoteSession();
    fetchMock
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(json({ session: r }, 201));
    await createTask({ projectId: f.projectId, prompt: "do x", hostId });
    const ids = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).id);
    expect(ids[0]).toBe(ids[1]);
    expect(row(r.id!).host_id).toBe(hostId);
  });

  it("an unlinked machine refuses with a way forward", async () => {
    const other = createHost("unlinked", "alice@other").id;
    await expect(
      createTask({ projectId: f.projectId, prompt: "do x", hostId: other })
    ).rejects.toThrow(/isn't linked/);
  });

  it("stacked and card tasks stay on this machine", async () => {
    await expect(
      createTask({ projectId: f.projectId, prompt: "x", hostId, cardId: "c" })
    ).rejects.toThrow(/this machine only/);
    const base = {
      branch: "feature/parent",
      tip: "a".repeat(40),
      stack: { parentName: "p", parentBranch: "feature/parent" },
    } as unknown as Parameters<typeof createTask>[0]["base"];
    await expect(
      createTask({ projectId: f.projectId, prompt: "x", hostId, base })
    ).rejects.toThrow(/this machine only/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("following it", () => {
  it("shows its state as that machine reports it, and finishes or leaves only on its word", async () => {
    const [live, merged, moved, missing] = [
      await startOne(),
      await startOne(),
      await startOne(),
      await startOne(),
    ];
    fetchMock.mockResolvedValueOnce(
      list([view(live, "review"), view(merged, "merged")], {
        moved: [{ id: moved.id, movedTo: "mac" }],
      })
    );
    const mine = (await listTasks()).filter((t) => t.hostId === hostId);
    expect(mine.find((t) => t.id === live.id)).toMatchObject({
      state: "review",
      hostName: "devbox",
      projectId: f.projectId,
      hostError: null,
    });
    expect(row(merged.id!).task_status).toBe("merged");
    expect(row(moved.id!).task_status).toBe("moved");
    // Missing from one list isn't moved: it stays, flagged.
    expect(row(missing.id!).task_status).toBe("running");
    expect(mine.find((t) => t.id === missing.id)?.hostError).toMatch(
      /Not in devbox's task list/
    );
  });

  it("says when the machine can't be reached instead of dropping its tasks", async () => {
    const r = await startOne();
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const t = (await listTasks()).find((v) => v.id === r.id);
    expect(t?.hostError).toMatch(/Can't reach AgentOS on devbox/);
    expect(row(r.id!).task_status).toBe("running");
  });
});

describe("signing off and dropping there", () => {
  const head = "a".repeat(40);

  it("sign-off goes to that machine, pinned to the reviewed commit", async () => {
    const r = await startOne();
    fetchMock
      .mockResolvedValueOnce(list([]))
      .mockResolvedValueOnce(json({ success: true, head }));
    await signOffTask(r.id!, { head });
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe(`http://devbox:3011/api/tasks/${r.id}/merge`);
    expect(JSON.parse(init.body)).toEqual({ head });
    expect(row(r.id!).task_status).toBe("merged");
  });

  it("refuses to ask an AgentOS that can't pin a merge", async () => {
    const r = await startOne();
    fetchMock.mockResolvedValueOnce(json({ tasks: [] }));
    await expect(signOffTask(r.id!, { head })).rejects.toThrow(
      /can't pin a merge/
    );
    expect(String(fetchMock.mock.calls.at(-1)![0])).not.toMatch(/merge$/);
    expect(row(r.id!).task_status).toBe("running");
  });

  it("fails loudly when the merge isn't confirmed at the reviewed commit", async () => {
    const r = await startOne();
    fetchMock
      .mockResolvedValueOnce(list([]))
      .mockResolvedValueOnce(json({ success: true, head: null }));
    await expect(signOffTask(r.id!, { head })).rejects.toThrow(
      /without confirming/
    );
  });

  it("a refused sign-off there leaves it running here", async () => {
    const r = await startOne();
    fetchMock.mockResolvedValueOnce(
      json({ error: "no Code review section" }, 409)
    );
    await expect(signOffTask(r.id!)).rejects.toThrow(/no Code review/);
    expect(row(r.id!).task_status).toBe("running");
  });

  it("drop goes to that machine", async () => {
    const r = await startOne();
    fetchMock.mockResolvedValueOnce(json({ success: true }));
    await dropTask(r.id!);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(
      `http://devbox:3011/api/tasks/${r.id}/drop`
    );
    expect(row(r.id!).task_status).toBe("dropped");
  });
});

it("refuses another id that names a session that isn't a task", async () => {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, 's', 't', '/x')`
  ).run(id);
  await expect(
    createTask({ id, projectId: f.projectId, prompt: "x" })
  ).rejects.toThrow(/taken/);
});
