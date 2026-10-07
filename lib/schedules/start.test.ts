import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../db";
import type { TaskState } from "../tasks/state";
import type { ChatState } from "../chat/events";
import type { Schedule, ScheduleRun } from "./store";

// What the task view and the chat runner report, per session.
const taskStates = new Map<string, TaskState>();
const chatStates = new Map<string, ChatState>();

vi.mock("../tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tasks")>()),
  taskView: async (s: { id: string }) => ({ state: taskStates.get(s.id) }),
}));
// Each send waits until the test settles it.
const sends: {
  id: string;
  text: string;
  settle: (ok: boolean) => void;
}[] = [];
vi.mock("../chat/runner", () => ({
  chatState: (id: string) => chatStates.get(id) ?? null,
  sendChatConfirmed: (id: string, input: { text: string }) =>
    new Promise((resolve, reject) =>
      sends.push({
        id,
        text: input.text,
        settle: (ok) =>
          ok ? resolve("delivered") : reject(new Error("worker gone")),
      })
    ),
}));
// Holds every start while `brakeOn` is set, as the orchestrator's brakes do.
let brakeOn: string | null = null;
vi.mock("../orchestrator/brakes", async (importOriginal) => {
  const real = await importOriginal<typeof import("../orchestrator/brakes")>();
  return {
    ...real,
    braked: async (
      _ws: string,
      kind: "task" | "session",
      start: () => Promise<string>
    ) => {
      if (brakeOn) throw new real.BrakeRefused(kind, brakeOn);
      return start();
    },
  };
});
// Never makes a folder in the real home.
vi.mock("../orchestrator/home", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../orchestrator/home")>()),
  ensureOrchestrator: (workspaceId: string) => ({ id: `orch-${workspaceId}` }),
}));

const { realDeps, stillRunning, scheduledMessage } = await import("./start");
const { Braked } = await import("./run");
const { createWorkspace, setProjectWorkspace } = await import("../workspaces");
const { createProject } = await import("../projects");

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

const schedule = (kind: Schedule["kind"]) => ({ kind }) as Schedule;
const run = (session_id: string | null) => ({ session_id }) as ScheduleRun;

describe("stillRunning", () => {
  beforeEach(() => {
    taskStates.clear();
    chatStates.clear();
  });

  it("a task is still going while it works or is blocked on Saad", async () => {
    for (const [state, busy] of [
      ["working", true],
      ["blocked", true],
      ["needs-input", false],
      ["review", false],
      ["exited", false],
    ] as const) {
      const id = session({ task_status: "running" });
      taskStates.set(id, state);
      expect(await stillRunning(schedule("task"), run(id)), state).toBe(busy);
    }
  });

  it("a finished or archived task isn't", async () => {
    const merged = session({ task_status: "merged" });
    taskStates.set(merged, "working");
    expect(await stillRunning(schedule("task"), run(merged))).toBe(false);
    const archived = session({ task_status: "running", archived: true });
    taskStates.set(archived, "working");
    expect(await stillRunning(schedule("task"), run(archived))).toBe(false);
    expect(await stillRunning(schedule("task"), run(null))).toBe(false);
  });

  it("a session is still going while its turn runs or waits on Saad", async () => {
    for (const [state, busy] of [
      ["running", true],
      ["waiting", true],
      ["idle", false],
    ] as const) {
      const id = session();
      chatStates.set(id, state);
      expect(await stillRunning(schedule("session"), run(id)), state).toBe(
        busy
      );
    }
  });

  it("an orchestrator message is done once delivered", async () => {
    const id = session();
    chatStates.set(id, "running");
    expect(await stillRunning(schedule("orchestrator"), run(id))).toBe(false);
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

describe("start links the run only once the prompt is in", () => {
  const target = (kind: Schedule["kind"]) => {
    const ws = createWorkspace(`ws-${randomUUID().slice(0, 6)}`);
    const project = createProject({
      name: `p-${randomUUID().slice(0, 6)}`,
      workingDirectory: "/tmp",
    });
    setProjectWorkspace(project.id, ws.id);
    return {
      id: randomUUID(),
      name: "Triage",
      prompt: "Go",
      kind,
      workspace_id: ws.id,
      project_id: project.id,
      timezone: "America/Chicago",
    } as Schedule;
  };
  const flush = () => new Promise((r) => setImmediate(r));

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
    const s = target("orchestrator");
    const run = realDeps.start(s, () => {});
    await flush();
    expect(sends[0].text).toMatch(/^\[Scheduled message "Triage" for p-/);
    sends[0].settle(true);
    await run;
  });
});

describe("brakes", () => {
  it("a session start the brakes hold throws Braked with the reason, starting nothing", async () => {
    sends.length = 0;
    brakeOn = "4 sessions are running in ws, at its limit of 4";
    try {
      const ws = createWorkspace(`ws-${randomUUID().slice(0, 6)}`);
      const project = createProject({
        name: `p-${randomUUID().slice(0, 6)}`,
        workingDirectory: "/tmp",
      });
      setProjectWorkspace(project.id, ws.id);
      const s = {
        id: randomUUID(),
        name: "Triage",
        prompt: "Go",
        kind: "session",
        workspace_id: ws.id,
        project_id: project.id,
        timezone: "America/Chicago",
      } as Schedule;
      const run = realDeps.start(s, () => {});
      await expect(run).rejects.toBeInstanceOf(Braked);
      await expect(run).rejects.toThrow(
        "4 sessions are running in ws, at its limit of 4"
      );
      expect(sends).toHaveLength(0);
    } finally {
      brakeOn = null;
    }
  });
});
