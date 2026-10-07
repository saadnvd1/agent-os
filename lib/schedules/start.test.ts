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
vi.mock("../chat/runner", () => ({
  chatState: (id: string) => chatStates.get(id) ?? null,
  sendChat: async () => {},
  sendChatConfirmed: async () => "delivered",
}));

const { stillRunning, scheduledMessage } = await import("./start");

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
