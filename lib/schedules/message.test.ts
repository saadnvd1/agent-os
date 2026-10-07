import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import type { WorkerHandlers } from "../chat/worker/client";
import type { WorkerCommand } from "../chat/worker/protocol";

// Chat workers are faked below the runner, so the real send path runs: a
// chat with no worker gets one started (the wake), which takes the message.
const workers = vi.hoisted(() => ({
  running: [] as string[],
  state: "idle" as "idle" | "running",
  started: [] as string[],
  sends: [] as { sessionId: string; text: string; from?: string }[],
}));
vi.mock("../chat/worker/client", async (original) => ({
  ...(await original<typeof import("../chat/worker/client")>()),
  runningWorkers: () => workers.running,
  connectWorker: async (
    sessionId: string,
    _spawn: boolean,
    handlers: WorkerHandlers
  ) => {
    const { buildId } = await import("../build");
    workers.started.push(sessionId);
    workers.running.push(sessionId);
    return {
      client: {
        command: (cmd: WorkerCommand) => {
          if (cmd.type !== "send") return;
          workers.sends.push({ sessionId, text: cmd.text, from: cmd.from });
          setTimeout(() =>
            handlers.onEvent({
              type: "item",
              item: {
                id: cmd.id,
                kind: "user",
                text: cmd.text,
                from: cmd.from,
                createdAt: Date.now(),
              },
            } as never)
          );
        },
        detach: () => {},
      },
      hello: {
        type: "hello",
        version: 1,
        build: buildId(),
        state: workers.state,
        streaming: [],
        caps: ["plan", "queue"],
      },
    };
  },
}));
// A terminal's state, by tmux name.
const panes = vi.hoisted(() => new Map<string, "running" | "idle">());
vi.mock("../status-detector", () => ({
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: (name: string) => panes.has(name),
    getStatus: async (name: string) => panes.get(name) ?? "dead",
    titleFor: () => "",
  },
}));
const phone = vi.hoisted(() => [] as string[]);
vi.mock("../notify", () => ({
  notifyPhone: (_source: string, text: string) => phone.push(text),
}));

const { db } = await import("../db");
const { registry } = await import("../chat/registry");
const { seedSession } = await import("../orchestrator/testing");
const { createProject } = await import("../projects");
const { createWorkspace, setProjectWorkspace } = await import("../workspaces");
const { recordPreviousName } = await import("../session-names");
const { realDeps } = await import("./start");
const { runSlot } = await import("./run");
const { tick } = await import("./scheduler");
const { createSchedule, listRuns, updateSchedule } = await import("./store");
const { checkInInput } = await import(".");
const { everyCron } = await import("./cron");

const at = (s: string) => Date.parse(s);
const CREATED = at("2026-10-07T13:00:00Z");

function setup(view: "chat" | "terminal" = "chat") {
  const ws = createWorkspace(`ws-${randomUUID().slice(0, 6)}`);
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp",
  });
  setProjectWorkspace(project.id, ws.id);
  const name = `chat-${randomUUID().slice(0, 6)}`;
  const sessionId = seedSession({ projectId: project.id, name, view });
  const schedule = createSchedule(
    {
      workspaceId: ws.id,
      name: "Check-ins",
      cron: "*/10 * * * *",
      prompt: "How's it going?",
      kind: "message",
      targetSessionId: sessionId,
    },
    CREATED
  );
  return { ws, project, sessionId, name, schedule };
}

// The chat's worker exited (idle 30 minutes): the server no longer has it.
function exitWorker(sessionId: string) {
  registry.live.delete(sessionId);
  workers.running = workers.running.filter((id) => id !== sessionId);
}

describe("message schedules: the target", () => {
  it("stores the session's id, and still reaches it after a rename", async () => {
    const { sessionId, schedule } = setup();
    expect(schedule.target_session_id).toBe(sessionId);
    recordPreviousName(sessionId, "old");
    db.prepare(`UPDATE sessions SET name = 'renamed' WHERE id = ?`).run(
      sessionId
    );
    const run = await runSlot(
      schedule,
      at("2026-10-07T13:10:00Z"),
      "schedule",
      realDeps
    );
    expect(run).toMatchObject({ outcome: "started", sessionId });
    expect(workers.sends.at(-1)).toMatchObject({
      sessionId,
      from: "Schedule Check-ins",
    });
    expect(workers.sends.at(-1)!.text).toContain("How's it going?");
  });

  it("the CLI's name resolves to the id, in that session's workspace", () => {
    const { ws, sessionId, name } = setup();
    const input = checkInInput({
      session: name,
      every: "30m",
      prompt: "status?",
    });
    expect(input).toMatchObject({
      workspaceId: ws.id,
      kind: "message",
      targetSessionId: sessionId,
      cron: "*/30 * * * *",
      name: `Check-in: ${name}`,
    });
  });

  it("refuses a session in another workspace, or none", () => {
    const { ws } = setup();
    const other = setup();
    const base = {
      workspaceId: ws.id,
      name: "x",
      cron: "*/10 * * * *",
      prompt: "p",
      kind: "message" as const,
    };
    expect(() =>
      createSchedule({ ...base, targetSessionId: other.sessionId })
    ).toThrow(/isn't in this schedule's workspace/);
    expect(() => createSchedule(base)).toThrow("Pick a session to message");
  });

  it("goes at most every 10 minutes", () => {
    const { schedule } = setup();
    expect(() => updateSchedule(schedule.id, { cron: "*/5 * * * *" })).toThrow(
      /every 10 minutes/
    );
    expect(everyCron("2h")).toBe("0 */2 * * *");
    expect(() => everyCron("7m")).toThrow(/divide the hour/);
  });
});

describe("message schedules: runs", () => {
  it("wakes an idle chat whose worker exited, and records delivered", async () => {
    const { sessionId, schedule } = setup();
    expect(workers.running).not.toContain(sessionId);
    await tick(realDeps, at("2026-10-07T13:10:05Z"));
    expect(workers.started.filter((id) => id === sessionId)).toHaveLength(1);
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "started",
      detail: "delivered",
      session_id: sessionId,
    });

    // Its worker exits again; the next run wakes it again.
    exitWorker(sessionId);
    await tick(realDeps, at("2026-10-07T13:20:05Z"));
    expect(workers.started.filter((id) => id === sessionId)).toHaveLength(2);
    expect(listRuns(schedule.id).map((r) => r.outcome)).toEqual([
      "started",
      "started",
    ]);
    // The message went to the bus too, as the schedule's.
    const row = db
      .prepare(
        `SELECT from_id, from_name, delivered_at FROM bus_messages WHERE to_id = ? ORDER BY id DESC`
      )
      .get(sessionId) as {
      from_id: null;
      from_name: string;
      delivered_at: string;
    };
    expect(row).toMatchObject({
      from_id: null,
      from_name: "Schedule Check-ins",
    });
    expect(row.delivered_at).toBeTruthy();
  });

  it("skips while the session is still working on the last one", async () => {
    const { sessionId, schedule } = setup();
    await tick(realDeps, at("2026-10-07T13:10:05Z"));
    registry.live.get(sessionId)!.state = "running";
    const before = workers.sends.length;
    await tick(realDeps, at("2026-10-07T13:20:05Z"));
    expect(workers.sends.length).toBe(before);
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "skipped",
      detail: "still working",
    });
    registry.live.get(sessionId)!.state = "idle";
    await tick(realDeps, at("2026-10-07T13:30:05Z"));
    expect(listRuns(schedule.id)[0]).toMatchObject({ outcome: "started" });
  });

  it("skips while a terminal agent is working", async () => {
    const { sessionId, schedule } = setup("terminal");
    const tmux = `claude-${sessionId}`;
    panes.set(tmux, "running");
    // A run that started earlier, so there's a previous message.
    db.prepare(
      `INSERT INTO schedule_runs (schedule_id, slot, slot_at, trigger, outcome, session_id)
       VALUES (?, 'earlier', 0, 'schedule', 'started', ?)`
    ).run(schedule.id, sessionId);
    await tick(realDeps, at("2026-10-07T13:10:05Z"));
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "skipped",
      detail: "still working",
    });
  });

  it("an archived session fails and notifies once until a run works again", async () => {
    const { sessionId, schedule } = setup();
    phone.length = 0;
    db.prepare(
      `UPDATE sessions SET archived_at = datetime('now') WHERE id = ?`
    ).run(sessionId);
    await tick(realDeps, at("2026-10-07T13:10:05Z"));
    await tick(realDeps, at("2026-10-07T13:20:05Z"));
    expect(listRuns(schedule.id).map((r) => [r.outcome, r.detail])).toEqual([
      ["failed", "session archived"],
      ["failed", "session archived"],
    ]);
    expect(phone).toEqual([`Schedule "Check-ins" failed: session archived`]);

    // Back, works, then fails again: that's news again.
    db.prepare(`UPDATE sessions SET archived_at = NULL WHERE id = ?`).run(
      sessionId
    );
    await tick(realDeps, at("2026-10-07T13:30:05Z"));
    expect(listRuns(schedule.id)[0].outcome).toBe("started");
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
    await tick(realDeps, at("2026-10-07T13:40:05Z"));
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "failed",
      detail: "session no longer exists",
    });
    expect(phone).toHaveLength(2);
  });

  it("a delivery that fails is recorded as FAILED with why", async () => {
    const { sessionId, schedule } = setup("terminal");
    // Its terminal isn't running.
    panes.delete(`claude-${sessionId}`);
    await tick(realDeps, at("2026-10-07T13:10:05Z"));
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "failed",
      detail: "FAILED: its terminal isn't running",
    });
  });
});
