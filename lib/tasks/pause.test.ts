import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, updateSessionRow } from "@/lib/db";
import { seedSession, seedWorkspace } from "@/lib/orchestrator/testing";

// The agent process is at the module edge: a chat's worker, a terminal's tmux.
let chatIs = "idle";
let turnEnds: Promise<{ stopped: true } | { stopped: false; reason: string }> =
  Promise.resolve({ stopped: true });
const released: string[] = [];
const killed: string[] = [];
const launched: { prompt: string; resume?: string }[] = [];
let failLaunch = false;
let tmuxAlive = false;

vi.mock("@/lib/chat/runner", () => ({
  chatState: () => chatIs,
  chatStateNow: () => chatIs,
  releaseChat: async (id: string) => void released.push(id),
  stopChat: () => undefined,
}));
vi.mock("@/lib/chat/stop", () => ({
  stopChatAtTurnEnd: () => turnEnds,
  stopChatTurn: async () => ({ stopped: true }),
}));
vi.mock("@/lib/chat/worker/client", () => ({
  waitForExit: async () => undefined,
}));
vi.mock("@/lib/status-detector", () => ({
  statusDetector: { sessionExists: () => tmuxAlive },
}));
vi.mock("./start", () => ({
  killTmux: async (name: string) => void killed.push(name),
}));
vi.mock("@/lib/agents/launch", () => ({
  launchClaude: async (o: { prompt: string; resume?: string }) => {
    if (failLaunch) throw new Error("launch failed");
    launched.push({ prompt: o.prompt, resume: o.resume });
  },
}));

const {
  PauseRefused,
  activePause,
  claimResume,
  dueResumes,
  forgetDriving,
  requestPause,
  requestResume,
  resumeNow,
  setResumeTime,
  sweepPauses,
  pauseViewOf,
} = await import("./pause");
const { setPaused } = await import("@/lib/orchestrator/pause");
const { chatHold } = await import("@/lib/chat/hold");

const dueOf = (id: string) => dueResumes().filter((d) => d.sessionId === id);
const settle = () => new Promise((r) => setTimeout(r, 20));
const hour = (n: number) => new Date(Date.now() + n * 3_600_000);

const sess = (id: string) =>
  db
    .prepare(
      `SELECT pause_state, paused_until, pause_id FROM session_rows WHERE id = ?`
    )
    .get(id) as {
    pause_state: string | null;
    paused_until: string | null;
    pause_id: number | null;
  };
const pauseOf = (id: string) =>
  db
    .prepare(
      `SELECT * FROM task_pauses WHERE session_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(id) as {
    id: number;
    state: string;
    end_reason: string | null;
    held_count: number;
    resume_requested_at: string | null;
    by_kind: string;
  };

function chatTask() {
  const t = seedWorkspace();
  const id = seedSession({
    projectId: t.app.id,
    name: "chatty",
    view: "chat",
    task: true,
  });
  return { ...t, id };
}
const queueChat = (
  sessionId: string,
  text: string,
  images: string | null = null
) =>
  db
    .prepare(
      `INSERT INTO chat_queue (id, session_id, position, text, images, image_count, sent_by, created_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM chat_queue WHERE session_id = ?), ?, ?, 0, ?, ?)`
    )
    .run(
      `q-${Math.random()}`,
      sessionId,
      sessionId,
      text,
      images,
      JSON.stringify({ from: "CI" }),
      Date.now()
    );
const queuedTexts = (sessionId: string) =>
  (
    db
      .prepare(
        `SELECT text FROM chat_queue WHERE session_id = ? ORDER BY position`
      )
      .all(sessionId) as {
      text: string;
    }[]
  ).map((r) => r.text);

beforeEach(() => {
  chatIs = "idle";
  turnEnds = Promise.resolve({ stopped: true });
  released.length = 0;
  killed.length = 0;
  launched.length = 0;
  failLaunch = false;
  tmuxAlive = false;
  forgetDriving();
});

describe("pausing a chat task", () => {
  it("runs pausing → paused at the turn boundary, and holds the chat", async () => {
    const t = chatTask();
    const p = requestPause(t.id, { until: hour(2) });
    expect(p.state).toBe("pausing");
    expect(sess(t.id).pause_state).toBe("pausing");
    expect(chatHold(t.id)).toMatch(/sent when the session resumes/);
    await settle();
    expect(sess(t.id).pause_state).toBe("paused");
    expect(pauseViewOf(t.id)).toMatchObject({ state: "paused", by: "person" });
    const events = db
      .prepare(
        `SELECT line AS text FROM orchestrator_events WHERE workspace_id = ?`
      )
      .all(t.workspace.id) as { text: string }[];
    expect(events.some((e) => /was paused until/.test(e.text))).toBe(true);
  });

  it("an until-resumed pause has no time", async () => {
    const t = chatTask();
    requestPause(t.id, { until: null });
    await settle();
    expect(sess(t.id).paused_until).toBeNull();
    expect(chatHold(t.id)).toMatch(/when the session is resumed/);
  });

  it("stays pausing while the turn runs, and a person resuming cancels it", async () => {
    const t = chatTask();
    let end!: (v: { stopped: true }) => void;
    turnEnds = new Promise((r) => (end = r));
    requestPause(t.id, { until: hour(1) });
    await settle();
    expect(sess(t.id).pause_state).toBe("pausing");
    await resumeNow(t.id, "person");
    expect(sess(t.id).pause_state).toBeNull();
    expect(pauseOf(t.id).end_reason).toBe("cancelled");
    end({ stopped: true });
    await settle();
    expect(sess(t.id).pause_state).toBeNull();
  });

  it("cancels itself, saying why, when the turn can't be ended", async () => {
    const t = chatTask();
    turnEnds = Promise.resolve({
      stopped: false,
      reason: "it asked a question",
    });
    requestPause(t.id, { until: hour(1) });
    await settle();
    expect(sess(t.id).pause_state).toBeNull();
    expect(pauseOf(t.id).end_reason).toBe("cancelled");
  });

  it.each([
    ["a chat waiting on you", () => (chatIs = "waiting"), /waiting on you/],
  ])("refuses %s", (_n, arrange, text) => {
    const t = chatTask();
    arrange();
    expect(() => requestPause(t.id, { until: hour(1) })).toThrow(text);
  });

  it("refuses a time in the past, one past 60 days, an orchestrator and a merged task", () => {
    const t = chatTask();
    expect(() =>
      requestPause(t.id, { until: new Date(Date.now() - 1000) })
    ).toThrow(PauseRefused);
    expect(() => requestPause(t.id, { until: hour(24 * 61) })).toThrow(
      /60 days/
    );
    updateSessionRow(db, t.id, { task_status: "merged" });
    expect(() => requestPause(t.id, { until: hour(1) })).toThrow(/merged/);
    updateSessionRow(db, t.id, {
      task_status: "running",
      role: "orchestrator",
    });
    expect(() => requestPause(t.id, { until: hour(1) })).toThrow(
      /orchestrator/i
    );
  });

  it("a second request while pausing replaces the time instead of stacking", async () => {
    const t = chatTask();
    turnEnds = new Promise(() => undefined);
    requestPause(t.id, { until: hour(1) });
    requestPause(t.id, { until: hour(3), mode: "now" });
    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM task_pauses WHERE session_id = ?`)
      .get(t.id) as { n: number };
    expect(count.n).toBe(1);
    expect(pauseOf(t.id)).toBeTruthy();
  });
});

describe("resuming", () => {
  async function paused(
    until: Date | null = hour(1),
    by: "person" | "orchestrator" = "person"
  ) {
    const t = chatTask();
    requestPause(t.id, { until, by });
    await settle();
    return t;
  }

  it("folds what was held into one continue prompt and ends once it's taken", async () => {
    const t = await paused();
    queueChat(t.id, "CI failed on lint");
    queueChat(t.id, "please rebase");
    queueChat(t.id, "look at this", '["img"]');
    expect(await claimResume(t.id, { reason: "person" })).toBe("resumed");
    const texts = queuedTexts(t.id);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("2 messages arrived");
    expect(texts[0]).toContain("From CI: CI failed on lint");
    expect(texts[1]).toBe("look at this");
    expect(sess(t.id).pause_state).toBe("resuming");
    expect(released).toContain(t.id);
    // The worker takes the continue prompt: the sweep ends the pause.
    db.prepare(
      `DELETE FROM chat_queue WHERE session_id = ? AND id LIKE 'pause-resume:%'`
    ).run(t.id);
    await sweepPauses();
    expect(sess(t.id).pause_state).toBeNull();
    expect(pauseOf(t.id)).toMatchObject({
      end_reason: "resumed",
      held_count: 3 - 1,
    });
  });

  it("a second claim does nothing: one continue prompt only", async () => {
    const t = await paused();
    await claimResume(t.id);
    expect(await claimResume(t.id)).toBe("gone");
    expect(queuedTexts(t.id).filter((x) => /resumed now/.test(x))).toHaveLength(
      1
    );
  });

  it("the timer makes a task's resume due; it isn't started by the pause module", async () => {
    const t = await paused(hour(1));
    db.prepare(
      `UPDATE task_pauses SET until_at = datetime('now', '-1 minute') WHERE session_id = ?`
    ).run(t.id);
    expect(dueOf(t.id)).toEqual([]);
    await sweepPauses();
    expect(dueOf(t.id)).toMatchObject([
      { sessionId: t.id, priority: "normal", byKind: "person" },
    ]);
    expect(sess(t.id).pause_state).toBe("paused");
  });

  it("an until-resumed pause is never due by itself", async () => {
    const t = await paused(null);
    await sweepPauses(Date.now() + 90 * 24 * 3_600_000);
    expect(dueOf(t.id)).toEqual([]);
    requestResume(t.id, "person");
    expect(dueOf(t.id)).toHaveLength(1);
  });

  it("the orchestrator can't lift a person's pause, but can lift its own", async () => {
    const mine = await paused(hour(1), "person");
    expect(() => requestResume(mine.id, "orchestrator")).toThrow(/a person/);
    const theirs = await paused(hour(1), "orchestrator");
    requestResume(theirs.id, "orchestrator");
    expect(pauseOf(theirs.id).resume_requested_at).not.toBeNull();
  });

  it("an orchestrator's pause waits while its workspace is paused; a person's ends on time", async () => {
    const t = chatTask();
    requestPause(t.id, { until: hour(1), by: "orchestrator" });
    await settle();
    const u = seedSession({
      projectId: t.app.id,
      name: "second",
      view: "chat",
      task: true,
    });
    requestPause(u, { until: hour(1), by: "person" });
    await settle();
    db.prepare(
      `UPDATE task_pauses SET until_at = datetime('now', '-1 minute')`
    ).run();
    setPaused(t.workspace.id, true);
    await sweepPauses();
    expect(pauseOf(t.id).resume_requested_at).toBeNull();
    expect(pauseOf(u).resume_requested_at).not.toBeNull();
    setPaused(t.workspace.id, false);
    await sweepPauses();
    expect(pauseOf(t.id).resume_requested_at).not.toBeNull();
  });

  it("changing the resume time clears an earlier request", async () => {
    const t = await paused(hour(1));
    requestResume(t.id, "person");
    setResumeTime(t.id, hour(5));
    expect(pauseOf(t.id).resume_requested_at).toBeNull();
    expect(dueOf(t.id)).toEqual([]);
    expect(() => setResumeTime(t.id, new Date(Date.now() - 1000))).toThrow(
      /passed/
    );
  });

  it("a paused task that merges ends its pause as finished", async () => {
    const t = await paused();
    updateSessionRow(db, t.id, { task_status: "merged" });
    await sweepPauses();
    expect(pauseOf(t.id).end_reason).toBe("finished");
    expect(sess(t.id).pause_state).toBeNull();
  });

  it("a restart mid-pause starts the stop again, and mid-resume releases the chat", async () => {
    const t = chatTask();
    turnEnds = new Promise(() => undefined);
    requestPause(t.id, { until: hour(1) });
    forgetDriving();
    turnEnds = Promise.resolve({ stopped: true });
    await sweepPauses();
    await settle();
    expect(sess(t.id).pause_state).toBe("paused");
    await claimResume(t.id);
    released.length = 0;
    await sweepPauses();
    expect(released).toContain(t.id);
  });
});

describe("a terminal task", () => {
  function terminal() {
    const t = seedWorkspace();
    const id = seedSession({
      projectId: t.app.id,
      name: "term",
      view: "terminal",
      task: true,
    });
    db.prepare(
      `UPDATE sessions SET status = 'idle', claude_session_id = 'cs-1', worktree_path = '/tmp/wt' WHERE id = ?`
    ).run(id);
    return { ...t, id };
  }

  it("ends its tmux at idle, holds a message, and relaunches with it folded in", async () => {
    const t = terminal();
    requestPause(t.id, { until: hour(1) });
    await settle();
    expect(killed.length).toBe(1);
    expect(sess(t.id).pause_state).toBe("paused");
    const p = pauseOf(t.id);
    db.prepare(
      `INSERT INTO bus_messages (from_id, from_name, to_id, to_name, body, held_pause_id) VALUES ('x', 'peer-a', ?, 'term', 'hello after', ?)`
    ).run(t.id, p.id);
    await claimResume(t.id, { reason: "person" });
    expect(launched).toHaveLength(1);
    expect(launched[0].resume).toBe("cs-1");
    expect(launched[0].prompt).toContain("From peer-a: hello after");
    expect(sess(t.id).pause_state).toBeNull();
    const row = db
      .prepare(`SELECT delivered_at FROM bus_messages WHERE to_id = ?`)
      .get(t.id) as {
      delivered_at: string | null;
    };
    expect(row.delivered_at).not.toBeNull();
  });

  it("refuses a terminal that's waiting on you", () => {
    const t = terminal();
    db.prepare(`UPDATE sessions SET status = 'waiting' WHERE id = ?`).run(t.id);
    expect(() => requestPause(t.id, { until: hour(1) })).toThrow(
      /waiting on you/
    );
  });

  it("refuses a terminal whose agent can't be started again", () => {
    const t = terminal();
    db.prepare(`UPDATE sessions SET agent_type = 'codex' WHERE id = ?`).run(
      t.id
    );
    expect(() => requestPause(t.id, { until: hour(1) })).toThrow(
      /started again/
    );
    db.prepare(
      `UPDATE sessions SET agent_type = 'claude', claude_session_id = NULL WHERE id = ?`
    ).run(t.id);
    expect(() => requestPause(t.id, { until: hour(1) })).toThrow(
      /started again/
    );
    expect(activePause(t.id)).toBeNull();
  });

  it("a relaunch that fails ends the pause with the reason, not stuck resuming", async () => {
    const t = terminal();
    requestPause(t.id, { until: hour(1) });
    await settle();
    failLaunch = true;
    await claimResume(t.id, { reason: "person" });
    expect(activePause(t.id)).toBeNull();
    expect(sess(t.id).pause_state).toBeNull();
    const ended = db
      .prepare(`SELECT end_reason FROM task_pauses WHERE session_id = ?`)
      .get(t.id) as { end_reason: string };
    expect(ended.end_reason).toBe("failed");
    await sweepPauses();
    expect(launched).toHaveLength(0);
  });

  it("a cut-off relaunch is finished by the sweep from the held rows, once", async () => {
    const t = terminal();
    requestPause(t.id, { until: hour(1) });
    await settle();
    const p = pauseOf(t.id);
    db.prepare(
      `INSERT INTO bus_messages (from_id, from_name, to_id, to_name, body, held_pause_id) VALUES ('x', 'peer-a', ?, 'term', 'm1', ?)`
    ).run(t.id, p.id);
    db.prepare(`UPDATE task_pauses SET state = 'resuming' WHERE id = ?`).run(
      p.id
    );
    updateSessionRow(db, t.id, { pause_state: "resuming" });
    await sweepPauses();
    expect(launched).toHaveLength(1);
    expect(launched[0].prompt).toContain("m1");
    await sweepPauses();
    expect(launched).toHaveLength(1);
    expect(activePause(t.id)).toBeNull();
  });
});
