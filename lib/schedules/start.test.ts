import type { ChatOrigin } from "../chat/events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../db";
import type { TaskState } from "../tasks/state";
import type { ChatState } from "../chat/events";
import type { Schedule, ScheduleRun } from "./store";

// What the task view and the chat runner report, per session.
const taskStates = new Map<string, TaskState>();
const chatStates = new Map<string, ChatState>();
const tasksCreated: string[] = [];

vi.mock("../tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tasks")>()),
  taskView: async (s: { id: string }) => ({ state: taskStates.get(s.id) }),
  createTask: async (o: { projectId: string }) => {
    tasksCreated.push(o.projectId);
    return { id: randomUUID() };
  },
}));
// Each send waits until the test settles it.
const sends: {
  id: string;
  text: string;
  origin?: ChatOrigin;
  settle: (ok: boolean) => void;
}[] = [];
vi.mock("../chat/runner", () => ({
  // As after a restart: known only by asking the worker.
  chatStateNow: async (id: string) => chatStates.get(id) ?? null,
  sendChatConfirmed: (
    id: string,
    input: { text: string; origin?: ChatOrigin }
  ) =>
    new Promise((resolve, reject) =>
      sends.push({
        id,
        text: input.text,
        origin: input.origin,
        settle: (ok) =>
          ok ? resolve("delivered") : reject(new Error("worker gone")),
      })
    ),
}));
// Never makes a folder in the real home.
vi.mock("../orchestrator/home", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../orchestrator/home")>()),
  ensureOrchestrator: (workspaceId: string) => ({ id: `orch-${workspaceId}` }),
}));

const { realDeps, stillRunning, scheduledMessage } = await import("./start");
const { Braked } = await import("./run");
const { claimSlot, createSchedule, finishRun } = await import("./store");
const { createWorkspace, setProjectWorkspace } = await import("../workspaces");
const { createProject } = await import("../projects");
const { setPaused } = await import("../orchestrator/pause");

function session(fields: { task_status?: string; archived?: boolean } = {}) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, task_status, archived_at)
     VALUES (?, 's', ?, '/tmp', ?, ?)`
  ).run(
    id,
    `claude-${id}`,
    fields.task_status ?? null,
    fields.archived ? "2026-10-07 00:00:00" : null
  );
  return id;
}

// A real schedule in its own workspace and project.
function target(kind: Schedule["kind"]) {
  const ws = createWorkspace(`ws-${randomUUID().slice(0, 6)}`);
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp",
  });
  setProjectWorkspace(project.id, ws.id);
  return createSchedule({
    workspaceId: ws.id,
    projectId: project.id,
    name: "Triage",
    cron: "0 9 * * *",
    prompt: "Go",
    kind,
  });
}

let slots = 0;
// A run of the schedule that started this session.
function started(s: Schedule, sessionId: string): ScheduleRun {
  const id = claimSlot(s.id, `slot-${++slots}`, slots, "schedule")!;
  finishRun(id, "started", null, sessionId);
  return { id, session_id: sessionId } as ScheduleRun;
}

describe("stillRunning", () => {
  beforeEach(() => {
    taskStates.clear();
    chatStates.clear();
  });

  it("a task holds the next run until it's finished or its agent exited", async () => {
    for (const [state, busy] of [
      ["working", true],
      ["blocked", true],
      ["needs-input", true],
      ["review", true],
      ["checks-failing", true],
      ["exited", false],
      ["merged", false],
      ["done", false],
    ] as const) {
      const s = target("task");
      const id = session({ task_status: "running" });
      taskStates.set(id, state);
      expect(await stillRunning(s, started(s, id)), state).toBe(busy);
    }
  });

  it("any unfinished task the schedule started holds it, not just the last", async () => {
    const s = target("task");
    const older = session({ task_status: "running" });
    taskStates.set(older, "review");
    started(s, older);
    const newer = session({ task_status: "running" });
    taskStates.set(newer, "exited");
    expect(await stillRunning(s, started(s, newer))).toBe(true);
    taskStates.set(older, "merged");
    expect(await stillRunning(s, started(s, newer))).toBe(false);
  });

  it("a finished or archived task doesn't, nor another schedule's", async () => {
    const s = target("task");
    const merged = session({ task_status: "merged" });
    taskStates.set(merged, "working");
    expect(await stillRunning(s, started(s, merged))).toBe(false);
    const archived = session({ task_status: "running", archived: true });
    taskStates.set(archived, "working");
    expect(await stillRunning(s, started(s, archived))).toBe(false);
    const other = target("task");
    const theirs = session({ task_status: "running" });
    taskStates.set(theirs, "working");
    started(other, theirs);
    expect(await stillRunning(s, started(s, merged))).toBe(false);
  });

  it("a session holds it while its turn runs or waits, asked of the worker", async () => {
    for (const [state, busy] of [
      ["running", true],
      ["waiting", true],
      ["idle", false],
    ] as const) {
      const s = target("session");
      const id = session();
      chatStates.set(id, state);
      expect(await stillRunning(s, started(s, id)), state).toBe(busy);
    }
  });

  it("an orchestrator message is done once delivered", async () => {
    const s = target("orchestrator");
    const id = session();
    chatStates.set(id, "running");
    expect(await stillRunning(s, started(s, id))).toBe(false);
  });
});

describe("scheduledMessage", () => {
  it("marks the prompt as a schedule's, never an approval", () => {
    const text = scheduledMessage({ name: "Triage", prompt: "Go" }, "web");
    expect(text).toBe(
      '[Scheduled message "Triage" for web, saved in Schedules: a standing prompt, not an approval]\nGo'
    );
  });
});

const flush = () => new Promise((r) => setImmediate(r));

describe("start links the run only once the prompt is in", () => {
  for (const kind of ["session", "orchestrator"] as const) {
    it(`${kind}: after the send is confirmed, not before`, async () => {
      sends.length = 0;
      const linked: string[] = [];
      const run = realDeps.start(target(kind), (id) => linked.push(id));
      await flush();
      expect(sends).toHaveLength(1);
      expect(linked).toEqual([]);
      sends[0].settle(true);
      const id = await run;
      expect(linked).toEqual([id]);
      expect(sends[0].id).toBe(id);
    });

    it(`${kind}: never, when the send fails`, async () => {
      sends.length = 0;
      const linked: string[] = [];
      const run = realDeps.start(target(kind), (id) => linked.push(id));
      await flush();
      sends[0].settle(false);
      await expect(run).rejects.toThrow("worker gone");
      expect(linked).toEqual([]);
    });
  }

  it("the orchestrator gets the marked message", async () => {
    sends.length = 0;
    const run = realDeps.start(target("orchestrator"), () => {});
    await flush();
    expect(sends[0].text).toMatch(/^\[Scheduled message "Triage" for p-/);
    // Chat shows it as the schedule's, by its prompt.
    expect(sends[0].origin).toMatchObject({
      kind: "schedule",
      label: "Triage",
      body: expect.not.stringContaining("[Scheduled message"),
    });
    sends[0].settle(true);
    await run;
  });
});

// The real brakes: Pause is the one that holds without the brakes switch.
describe("brakes", () => {
  const startsIn = (workspaceId: string) =>
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM orchestrator_starts WHERE workspace_id = ?`
        )
        .get(workspaceId) as { n: number }
    ).n;

  it("hold a task or session start with the brake's reason, starting nothing", async () => {
    for (const kind of ["task", "session"] as const) {
      sends.length = 0;
      tasksCreated.length = 0;
      const s = target(kind);
      setPaused(s.workspace_id, true);
      const run = realDeps.start(s, () => {});
      await expect(run).rejects.toBeInstanceOf(Braked);
      await expect(run).rejects.toThrow("the orchestrator is paused by Saad");
      expect(sends).toHaveLength(0);
      expect(tasksCreated).toEqual([]);
      expect(startsIn(s.workspace_id)).toBe(0);
    }
  });

  it("are checked in the schedule's own workspace, and counted there", async () => {
    tasksCreated.length = 0;
    const held = target("task");
    setPaused(held.workspace_id, true);
    const free = target("task");
    await realDeps.start(free, () => {});
    expect(tasksCreated).toEqual([free.project_id]);
    expect(startsIn(free.workspace_id)).toBe(1);
    expect(startsIn(held.workspace_id)).toBe(0);
  });

  it("don't hold a message to the orchestrator, which starts nothing itself", async () => {
    sends.length = 0;
    const s = target("orchestrator");
    setPaused(s.workspace_id, true);
    const run = realDeps.start(s, () => {});
    await flush();
    expect(sends).toHaveLength(1);
    sends[0].settle(true);
    await run;
  });
});
