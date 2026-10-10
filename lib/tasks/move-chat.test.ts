import fs from "fs";
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
    `${process.env.TMPDIR || "/tmp"}/aos-move-chat-wt-${process.pid}-${Date.now()}`
);
vi.mock("../worktrees", async (orig) => ({
  ...(await orig<typeof import("../worktrees")>()),
  WORKTREES_DIR: WT_ROOT,
}));
vi.mock("../env-setup", () => ({ setupWorktree: vi.fn(async () => ({})) }));
vi.mock("../agents/launch", () => ({ launchClaude: vi.fn(async () => {}) }));
vi.mock("../project-config/database", async (orig) => ({
  ...(await orig<typeof import("../project-config/database")>()),
  dropSessionDatabase: vi.fn(async () => {}),
}));
// The worker is a process of its own; what's checked here is what the move
// asks of it: stop between turns, start on arrival, let go on a resume.
vi.mock("../chat/stop", () => ({ stopChatAtTurnEnd: vi.fn() }));
vi.mock("../chat/runner", async (orig) => ({
  ...(await orig<typeof import("../chat/runner")>()),
  sendChat: vi.fn(async () => {}),
  stopChat: vi.fn(),
  releaseChat: vi.fn(async () => {}),
}));

import { randomUUID } from "crypto";
import { db } from "../db";
import { createHost } from "../hosts";
import { saveHostLink } from "../hosts/remote-api";
import { moveTask } from "./move-flow";
import { launchClaude } from "../agents/launch";
import { stopChatAtTurnEnd } from "../chat/stop";
import { releaseChat, sendChat } from "../chat/runner";
import { listItems } from "../chat/store";
import { listQueue } from "../chat/queued";
import { chatHold, chatRefusal } from "../chat/hold";
import { exportOrResume, exportTask, markMoved } from "./move";
import { importTask } from "./import";
import { MOVE_TURN_WAIT_MS } from "./move-chat";
import { MAX_CHAT_BYTES } from "./move-bundle";
import {
  CLAUDE_ID,
  git,
  row,
  seedTask as seed,
  setupMoveRepo,
  json,
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
beforeEach(() => {
  vi.mocked(launchClaude).mockReset();
  vi.mocked(sendChat).mockReset();
  vi.mocked(releaseChat).mockReset();
  vi.mocked(stopChatAtTurnEnd).mockReset().mockResolvedValue({ stopped: true });
});

// A chat task with a conversation on screen and two messages waiting.
async function seedChat(branch: string) {
  const task = await seed(f, WT_ROOT, branch);
  db.prepare(
    `UPDATE sessions SET view = 'chat', chat_access = 'edits', chat_plan = 1,
       chat_context = '{"used":10}' WHERE id = ?`
  ).run(task.id);
  const items = [
    { id: "user-1", kind: "user", text: "remember the word PELICAN" },
    {
      id: "tool-1",
      kind: "tool",
      name: "Read",
      input: { file_path: `${task.cwd}/work.txt` },
      status: "done",
    },
    { id: "assistant-1", kind: "assistant", text: "Noted: PELICAN." },
  ];
  items.forEach((item, n) =>
    db
      .prepare(
        `INSERT INTO chat_items (session_id, item_id, seq, data) VALUES (?, ?, ?, ?)`
      )
      .run(task.id, item.id, n + 1, JSON.stringify({ ...item, createdAt: n }))
  );
  for (const [n, text] of ["first queued", "second queued"].entries())
    db.prepare(
      `INSERT INTO chat_queue (id, session_id, position, text, image_count, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    ).run(`user-q${n}`, task.id, n + 1, text, 100 + n);
  return task;
}

// What the machine it leaves does once the other has it.
function leave(id: string, cwd: string, branch: string) {
  markMoved(id, "box");
  git(f.repo, "worktree", "remove", "--force", cwd);
  git(f.repo, "branch", "-D", branch);
}

describe("moving a chat task", () => {
  it("stops its agent between turns, then packs its history, queue and settings", async () => {
    const { id, cwd } = await seedChat("feature/chat-out");
    let heldWhileStopping: unknown = null;
    vi.mocked(stopChatAtTurnEnd).mockImplementation(async () => {
      heldWhileStopping = [row(id).task_status, chatHold(id)];
      return { stopped: true };
    });
    const bundle = await exportTask(id, "box");
    // Held from before the wait: what's sent meanwhile queues.
    expect(heldWhileStopping).toEqual([
      "moving",
      expect.stringMatching(/move/),
    ]);
    // Packed: a message now would be left behind here, so it's refused.
    expect(chatHold(id)).toBeNull();
    expect(chatRefusal(id)).toBe(
      "It's moving to box; send it there once it arrives"
    );
    expect(vi.mocked(stopChatAtTurnEnd).mock.calls[0]).toEqual([
      id,
      expect.objectContaining({ waitMs: MOVE_TURN_WAIT_MS }),
    ]);
    // A chat has no agent in tmux to kill, and isn't relaunched there.
    expect(launchClaude).not.toHaveBeenCalled();
    expect(bundle.claude).toMatchObject({ sessionId: CLAUDE_ID, cwd });
    expect(bundle.chat).toMatchObject({
      access: "edits",
      plan: true,
      context: '{"used":10}',
      queue: [
        { id: "user-q0", text: "first queued" },
        { id: "user-q1", text: "second queued" },
      ],
    });
    expect(bundle.chat!.items.map((i) => i.id)).toEqual([
      "user-1",
      "tool-1",
      "assistant-1",
    ]);
  });

  it("refuses mid-turn rather than cut it short, and carries on here", async () => {
    const { id } = await seedChat("feature/chat-busy");
    vi.mocked(stopChatAtTurnEnd).mockResolvedValue({
      stopped: false,
      reason: "its agent's turn was still running after 3 min",
    });
    await expect(exportOrResume(id, "box")).rejects.toThrow(
      "Not moving it: its agent's turn was still running after 3 min"
    );
    expect(row(id)).toMatchObject({ task_status: "running", moved_to: null });
    // Resumed as a chat: its queue goes on, nothing relaunches in tmux.
    expect(releaseChat).toHaveBeenCalledWith(id);
    expect(launchClaude).not.toHaveBeenCalled();
    expect(listQueue(id)).toHaveLength(2);
    expect(listItems(id)).toHaveLength(3);
  });

  it("arrives as a chat: history under this machine's paths, the queue, and a worker on the same conversation", async () => {
    const { id, cwd } = await seedChat("feature/chat-in");
    const bundle = await exportTask(id, "box");
    leave(id, cwd, "feature/chat-in");
    const arrived = await importTask(bundle);
    const newCwd = arrived.working_directory;
    expect(newCwd).not.toBe(cwd);
    expect(row(arrived.id)).toMatchObject({
      view: "chat",
      chat_access: "edits",
      chat_plan: 1,
      claude_session_id: CLAUDE_ID,
      task_status: "running",
    });
    // Its worker's system prompt carries the task brief, as at a start.
    expect(row(arrived.id).task_brief).toContain("feature/chat-in");
    const items = listItems(arrived.id);
    expect(items.map((i) => i.id)).toEqual(["user-1", "tool-1", "assistant-1"]);
    expect(JSON.stringify(items[1])).toContain(`${newCwd}/work.txt`);
    expect(JSON.stringify(items[1])).not.toContain(cwd);
    expect(listQueue(arrived.id).map((m) => m.text)).toEqual([
      "first queued",
      "second queued",
    ]);
    // The worker starts on the carried conversation with the arrival note.
    expect(launchClaude).not.toHaveBeenCalled();
    const [to, message] = vi.mocked(sendChat).mock.calls[0];
    expect(to).toBe(arrived.id);
    expect(message.text).toContain("moved here");
    expect(message.origin).toMatchObject({ kind: "system" });
  });

  it("a failed arrival leaves no row, history or queue behind", async () => {
    const { id, cwd } = await seedChat("feature/chat-fail");
    const bundle = await exportTask(id, "box");
    leave(id, cwd, "feature/chat-fail");
    vi.mocked(sendChat).mockRejectedValueOnce(
      new Error("The chat worker didn't start")
    );
    await expect(importTask(bundle)).rejects.toThrow(/didn't start/);
    const left = db
      .prepare(`SELECT id FROM sessions WHERE moved_from = ?`)
      .all(id) as { id: string }[];
    expect(left).toEqual([]);
    for (const table of ["chat_items", "chat_queue"])
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM ${table} WHERE session_id NOT IN (SELECT id FROM sessions)`
          )
          .get()
      ).toEqual({ n: 0 });
  });

  it("goes there and back with its history and queue intact", async () => {
    const { id, cwd } = await seedChat("feature/chat-trip");
    const out = await exportTask(id, "box");
    leave(id, cwd, "feature/chat-trip");
    const there = await importTask(out);

    const back = await exportTask(there.id, "mac");
    expect(row(there.id).task_status).toBe("moving");
    leave(there.id, there.working_directory, "feature/chat-trip");
    const home = await importTask(back);

    expect(listItems(home.id).map((i) => i.id)).toEqual(
      listItems(id).map((i) => i.id)
    );
    expect(JSON.stringify(listItems(home.id))).toContain(
      `${home.working_directory}/work.txt`
    );
    expect(listQueue(home.id).map((m) => m.text)).toEqual([
      "first queued",
      "second queued",
    ]);
    expect(row(home.id)).toMatchObject({
      view: "chat",
      claude_session_id: CLAUDE_ID,
    });
  });

  it("refuses a chat bundle with a bad access level or item", async () => {
    const { id } = await seedChat("feature/chat-bad");
    const bundle = await exportTask(id, "box");
    await expect(
      importTask({
        ...bundle,
        chat: { ...bundle.chat!, access: "root" as never },
      })
    ).rejects.toThrow(/Bad chat access/);
    await expect(
      importTask({
        ...bundle,
        chat: { ...bundle.chat!, items: [{ id: 1 } as never] },
      })
    ).rejects.toThrow(/Bad chat item/);
    const chat = bundle.chat!;
    const bad: [object, RegExp][] = [
      [{ queue: "x" }, /Bad chat queue/],
      [{ queue: [{ ...chat.queue[0], images: 5 }] }, /Bad queued message/],
      [
        { queue: [{ ...chat.queue[0], createdAt: "now" }] },
        /Bad queued message/,
      ],
      [{ resumeAt: 5 }, /Bad chat/],
      [
        { items: [{ id: "big", data: "x".repeat(MAX_CHAT_BYTES + 1) }] },
        /too large to move/,
      ],
    ];
    for (const [change, error] of bad)
      await expect(
        importTask({ ...bundle, chat: { ...chat, ...change } as never })
      ).rejects.toThrow(error);
  });
});

describe("moving a chat task to a linked machine", () => {
  const fetchMock = vi.fn();
  let hostId: string;
  beforeAll(() => {
    hostId = createHost("chatbox", "alice@chatbox").id;
    saveHostLink(hostId, "http://chatbox:3011", "tok");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => fetchMock.mockReset());

  it("won't hand one to a machine that would run it as a terminal", async () => {
    const { id } = await seedChat("feature/chat-old-box");
    fetchMock.mockResolvedValueOnce(
      json({ tasks: [], capabilities: ["pinned-merge", "move", "chat-turn"] })
    );
    await expect(moveTask(id, hostId)).rejects.toThrow(
      "chatbox's AgentOS can't move chat tasks yet; update it first"
    );
    expect(row(id).task_status).toBe("running");
    expect(stopChatAtTurnEnd).not.toHaveBeenCalled();
  });

  it("won't take one back from a machine that can't hand over its chat, or can't say", async () => {
    const mirror = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id, host_id,
         task_status, branch_name, view)
       VALUES (?, 'Fix it', ?, '/home/alice/wt', ?, ?, 'running', 'feature/chat-back', 'chat')`
    ).run(mirror, `claude-${mirror}`, f.projectId, hostId);
    fetchMock.mockResolvedValueOnce(
      json({ tasks: [], capabilities: ["move"] })
    );
    await expect(moveTask(mirror, "local")).rejects.toThrow(
      "chatbox's AgentOS can't move chat tasks yet; update it first"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    await expect(moveTask(mirror, "local")).rejects.toThrow(
      "Can't ask chatbox whether it takes chat tasks"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(row(mirror).task_status).toBe("running");
  });

  it("hands it over with its chat, and mirrors it as a chat", async () => {
    const { id } = await seedChat("feature/chat-box");
    const there = randomUUID();
    fetchMock
      .mockResolvedValueOnce(json({ tasks: [], capabilities: ["chat-move"] }))
      .mockResolvedValueOnce(
        json(
          {
            session: {
              id: there,
              name: "Fix it",
              tmux_name: `claude-${there}`,
              working_directory: "/home/alice/wt",
              worktree_path: "/home/alice/wt",
              model: "sonnet",
              branch_name: "feature/chat-box",
              base_branch: "main",
              task_prompt: "fix the thing",
              view: "chat",
            },
          },
          201
        )
      );
    await moveTask(id, hostId);
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sent.chat.items).toHaveLength(3);
    expect(sent.chat.queue).toHaveLength(2);
    expect(row(id)).toMatchObject({
      task_status: "moved",
      moved_to: "chatbox",
    });
    expect(row(there)).toMatchObject({ host_id: hostId, view: "chat" });
  });
});
