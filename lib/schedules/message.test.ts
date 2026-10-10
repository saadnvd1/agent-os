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
  sends: [] as {
    sessionId: string;
    text: string;
    from?: string;
    origin?: unknown;
  }[],
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
          workers.sends.push({
            sessionId,
            text: cmd.text,
            from: cmd.from,
            origin: cmd.origin,
          });
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
const { createSchedule, getSchedule, listRuns, updateSchedule } =
  await import("./store");
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

// Seeded, not made: making one writes a folder in the real home.
function seedOrchestrator(workspaceId: string): string {
  const id = randomUUID();
  const name = db
    .prepare(`SELECT name FROM workspaces WHERE id = ?`)
    .get(workspaceId) as { name: string };
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, view, role, workspace_id)
     VALUES (?, ?, ?, '/tmp', 'chat', 'orchestrator', ?)`
  ).run(id, `${name.name} orchestrator`, `claude-${id}`, workspaceId);
  return id;
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
      // Shown in the chat as the schedule's, by its prompt.
      origin: {
        kind: "schedule",
        label: "Check-ins",
        body: schedule.prompt,
      },
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

describe("message schedules: who can aim them where", () => {
  it("refuses the orchestrator as a target", () => {
    const { ws } = setup();
    // Seeded, not made: making one writes a folder in the real home.
    const orch = { id: randomUUID() };
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, view, role, workspace_id)
       VALUES (?, 'orchestrator', ?, '/tmp', 'chat', 'orchestrator', ?)`
    ).run(orch.id, `claude-${orch.id}`, ws.id);
    expect(() =>
      createSchedule({
        workspaceId: ws.id,
        name: "x",
        cron: "*/10 * * * *",
        prompt: "p",
        kind: "message",
        targetSessionId: orch.id,
      })
    ).toThrow(/orchestrator takes orchestrator schedules/);
  });

  it("a check-in on the orchestrator follows whichever session is orchestrator", async () => {
    const { ws } = setup();
    const first = seedOrchestrator(ws.id);
    const input = checkInInput({
      session: first,
      from: first,
      every: "30m",
      prompt: "check in",
    });
    expect(input).toMatchObject({
      kind: "orchestrator",
      targetSessionId: null,
      createdBySessionId: first,
    });
    // An agent's check-in on the orchestrator is held to a message's limit,
    // when it's made and when it's edited.
    expect(() =>
      createSchedule(
        checkInInput({
          session: first,
          from: first,
          cron: "*/5 * * * *",
          prompt: "p",
        })
      )
    ).toThrow(/every 10 minutes/);
    const schedule = createSchedule(input, CREATED);
    expect(() => updateSchedule(schedule.id, { cron: "*/5 * * * *" })).toThrow(
      /every 10 minutes/
    );
    // Saad's own orchestrator schedules keep no such limit.
    const saved = createSchedule({
      workspaceId: ws.id,
      name: "Often",
      cron: "*/5 * * * *",
      prompt: "p",
      kind: "orchestrator",
    });
    expect(updateSchedule(saved.id, { cron: "*/2 * * * *" }).cron).toBe(
      "*/2 * * * *"
    );
    await runSlot(schedule, at("2026-10-07T13:30:00Z"), "schedule", realDeps);
    expect(workers.sends.at(-1)).toMatchObject({ sessionId: first });
    expect(workers.sends.at(-1)!.text).toContain(
      `set up by agent session "${ws.name} orchestrator" (${first.slice(0, 8)}), not by the user`
    );

    // The orchestrator is replaced: the next run goes to the new one.
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(first);
    const second = seedOrchestrator(ws.id);
    const run = await runSlot(
      schedule,
      at("2026-10-07T14:00:00Z"),
      "schedule",
      realDeps
    );
    expect(run).toMatchObject({ outcome: "started", sessionId: second });
    expect(workers.sends.at(-1)).toMatchObject({ sessionId: second });
    expect(workers.sends.at(-1)!.text).toContain(
      `set up by agent session "a session that's gone"`
    );
    expect(getSchedule(schedule.id)!.enabled).toBe(true);
  });

  it("an agent schedules only in its own workspace", () => {
    const mine = setup();
    const other = setup();
    const agent = seedSession({ projectId: mine.project.id, name: "agent" });
    expect(() =>
      checkInInput({ session: other.name, from: agent, prompt: "p" })
    ).toThrow(/isn't in your workspace/);
    expect(
      checkInInput({ session: mine.name, from: agent, prompt: "p" })
    ).toMatchObject({ createdBySessionId: agent });
    expect(() =>
      checkInInput({ session: mine.name, from: "no-such-session", prompt: "p" })
    ).toThrow("Unknown sender session");
  });

  it("an agent's schedule reaches the session as that agent's, not the user's", async () => {
    const { project, name, sessionId } = setup();
    const agent = seedSession({ projectId: project.id, name: "planner" });
    const schedule = createSchedule(
      checkInInput({ session: name, from: agent, prompt: "status?" }),
      CREATED
    );
    await runSlot(schedule, at("2026-10-07T13:10:00Z"), "schedule", realDeps);
    const sent = workers.sends.filter((m) => m.sessionId === sessionId).at(-1)!;
    expect(sent.from).toBe(`Schedule ${schedule.name}, set up by "planner"`);
    expect(sent.origin).toMatchObject({ kind: "schedule", sessionId: agent });
    expect(sent.text).toContain(
      `set up by agent session "planner" (${agent.slice(0, 8)}), not by the user`
    );
    expect(sent.text).not.toContain("saved in Schedules");

    // The agent is gone: still labelled an agent's, never the user's.
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(agent);
    await runSlot(schedule, at("2026-10-07T13:20:00Z"), "schedule", realDeps);
    const later = workers.sends
      .filter((m) => m.sessionId === sessionId)
      .at(-1)!;
    expect(later.text).toContain(
      `set up by agent session "a session that's gone"`
    );
    expect(later.text).not.toContain("saved in Schedules");
  });

  it.each(['x"y', "x]y", "x[y", "x\ny"])(
    "refuses a name that could break out of the label: %j",
    (name) => {
      const { schedule } = setup();
      expect(() => updateSchedule(schedule.id, { name })).toThrow(
        /quotes or \[ \]/
      );
    }
  );
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

  it.each([
    [
      "deleted",
      `DELETE FROM sessions WHERE id = ?`,
      "session no longer exists",
    ],
    [
      "finished",
      `UPDATE sessions SET task_status = 'done' WHERE id = ?`,
      "session finished",
    ],
  ])(
    "a %s session pauses the schedule after one failure, with one notice",
    async (_, gone, why) => {
      const { ws, sessionId, schedule } = setup();
      phone.length = 0;
      db.prepare(gone).run(sessionId);
      await tick(realDeps, at("2026-10-07T13:10:05Z"));
      await tick(realDeps, at("2026-10-07T13:20:05Z"));
      await tick(realDeps, at("2026-10-07T13:30:05Z"));
      expect(listRuns(schedule.id).map((r) => [r.outcome, r.detail])).toEqual([
        ["failed", `${why}; paused`],
      ]);
      expect(getSchedule(schedule.id)!.enabled).toBe(false);
      const notice = `Schedule "Check-ins" is paused: ${why}. Point it at another session or delete it.`;
      expect(phone).toEqual([notice]);
      // A notice, not something for Saad to decide.
      expect(
        db
          .prepare(
            `SELECT kind, text FROM orchestrator_notes WHERE workspace_id = ?`
          )
          .all(ws.id)
      ).toEqual([{ kind: "pause", text: notice }]);
      // Turning it back on means pointing it somewhere that exists.
      expect(() => updateSchedule(schedule.id, { enabled: true })).toThrow(
        `Can't message that session: ${why}`
      );
    }
  );

  it("an archived session fails and notifies once, and stays on: it can come back", async () => {
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
    expect(getSchedule(schedule.id)!.enabled).toBe(true);
    db.prepare(`UPDATE sessions SET archived_at = NULL WHERE id = ?`).run(
      sessionId
    );
    await tick(realDeps, at("2026-10-07T13:30:05Z"));
    expect(listRuns(schedule.id)[0].outcome).toBe("started");
  });

  it("an agent's check-in on the orchestrator waits while it's working; Saad's doesn't", async () => {
    const { ws } = setup();
    const orch = seedOrchestrator(ws.id);
    const agentMade = createSchedule(
      checkInInput({ session: orch, from: orch, prompt: "check in" }),
      CREATED
    );
    const saved = createSchedule(
      checkInInput({ session: orch, prompt: "report", name: "Report" }),
      CREATED
    );
    await tick(realDeps, at("2026-10-07T13:30:05Z"));
    expect(listRuns(agentMade.id)[0]).toMatchObject({ outcome: "started" });
    expect(listRuns(saved.id)[0]).toMatchObject({ outcome: "started" });
    registry.live.get(orch)!.state = "running";
    await tick(realDeps, at("2026-10-07T14:00:05Z"));
    expect(listRuns(agentMade.id)[0]).toMatchObject({
      outcome: "skipped",
      detail: "still running",
    });
    expect(listRuns(saved.id)[0]).toMatchObject({ outcome: "started" });
  });

  it("a delivery that fails is recorded as FAILED with why", async () => {
    const { sessionId, schedule } = setup("terminal");
    // Its terminal isn't running.
    panes.delete(`claude-${sessionId}`);
    phone.length = 0;
    await tick(realDeps, at("2026-10-07T13:10:05Z"));
    await tick(realDeps, at("2026-10-07T13:20:05Z"));
    expect(listRuns(schedule.id).map((r) => [r.outcome, r.detail])).toEqual([
      ["failed", "FAILED: its terminal isn't running"],
      ["failed", "FAILED: its terminal isn't running"],
    ]);
    // Its session is still there: it keeps trying, and says so once.
    expect(getSchedule(schedule.id)!.enabled).toBe(true);
    expect(phone).toEqual([
      `Schedule "Check-ins" failed: FAILED: its terminal isn't running`,
    ]);
  });
});
