import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db";
import { seedSession, seedWorkspace } from "./testing";
import type { UsageState } from "./usage";

// Sessions named "busy-*" are working; the rest are idle.
const busy = new Set<string>();
let usage: UsageState = { window: null };

vi.mock("@/lib/status-detector", () => ({
  checkWaitingPatterns: () => false,
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: () => true,
    getStatus: async (tmux: string) => (busy.has(tmux) ? "running" : "idle"),
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    capturePane: async () => "",
  },
}));
vi.mock("@/lib/tasks/gh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks/gh")>()),
  run: async () => "",
  findPR: async () => null,
}));
vi.mock("@/lib/agents/spawn", () => ({
  spawnSession: async (o: { project: string; prompt: string }) =>
    ({
      id: seedSession({ projectId: o.project, name: o.prompt }),
      name: o.prompt,
    }) as Session,
}));
vi.mock("./usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./usage")>()),
  readUsage: () => usage,
}));

const { db } = await import("@/lib/db");
const { ensureOrchestrator } = await import("./home");
const { runTool } = await import("./serve");
const { listNotes } = await import("./notes");
const { usageWindow, windowRefusal } = await import("./usage");
const { answerAsk, openAsks } = await import("./asks");
const { setPaused } = await import("./pause");
// The real reader, under the mock the brakes use.
const { readUsage } =
  await vi.importActual<typeof import("./usage")>("./usage");

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-brakes-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
beforeEach(() => {
  busy.clear();
  usage = { window: null };
});

function workspace() {
  const ws = seedWorkspace();
  ensureOrchestrator(ws.workspace.id);
  const start = (prompt: string) =>
    runTool(ws.workspace.id, "start_session", {
      project: ws.app.name,
      prompt,
    });
  return { ...ws, start };
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe("the running brake", () => {
  it("refuses a start at 4 running sessions, notes it once, and lifts", async () => {
    const ws = workspace();
    for (let i = 0; i < 4; i++) {
      const id = seedSession({ projectId: ws.api.id, name: `busy-${i}` });
      busy.add(`claude-${id}`);
    }
    await expect(ws.start("one more")).rejects.toThrow(
      /Brake: not starting a session: 4 sessions are running in .*, at its limit of 4/
    );
    await expect(ws.start("and another")).rejects.toThrow(/Brake/);
    const notes = listNotes(ws.workspace.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: "brake" });
    expect(notes[0].text).toMatch(/New starts paused: 4 sessions are running/);

    busy.clear();
    await expect(ws.start("now it fits")).resolves.toMatch(/Started session/);
  });

  it("counts a session it just started before its status shows it", async () => {
    const ws = workspace();
    db.prepare(`UPDATE workspaces SET orch_max_running = 2 WHERE id = ?`).run(
      ws.workspace.id
    );
    await ws.start("a");
    await ws.start("b");
    await expect(ws.start("c")).rejects.toThrow(/2 sessions are running/);
  });
});

describe("the starts-per-hour brake", () => {
  it("allows 6 starts an hour by default, then refuses", async () => {
    const ws = workspace();
    const insert = db.prepare(
      `INSERT INTO orchestrator_starts (workspace_id, kind, target, created_at) VALUES (?, 'task', NULL, ?)`
    );
    for (let i = 0; i < 5; i++)
      insert.run(ws.workspace.id, ago(10 * 60 * 1000));
    insert.run(ws.workspace.id, ago(2 * 60 * 60 * 1000));
    await expect(ws.start("sixth")).resolves.toMatch(/Started/);
    await expect(ws.start("seventh")).rejects.toThrow(
      /6 starts in the last hour, at the limit of 6/
    );
  });
});

describe("the usage window brake", () => {
  const now = 1_800_000_000;
  const file = (samples: [number, number][], window: number) => ({
    samples,
    window,
  });

  it("projects when the window runs out, as dispatch does", () => {
    // 40% → 60% in 20 minutes: 1 point a minute, 40 minutes left.
    const w = usageWindow(
      file(
        [
          [now - 1230, 40],
          [now - 30, 60],
        ],
        now + 3 * 3600
      ),
      now
    );
    expect(w).toMatchObject({ pct: 60, burnPerMin: 1, capsIn: 2400 });
    expect(windowRefusal(w)).toMatch(
      /60% used .* runs out in 40m, before it resets in 3h0m/
    );
    // The same burn with the reset 30 minutes away is fine.
    expect(
      usageWindow(
        file(
          [
            [now - 1230, 40],
            [now - 30, 60],
          ],
          now + 1800
        ),
        now
      )?.capsIn
    ).toBeNull();
  });

  it("says nothing from a stale sample or a window already reset", () => {
    expect(usageWindow(file([[now - 3600, 90]], now + 600), now)).toBeNull();
    expect(usageWindow(file([[now - 10, 90]], now - 1), now)).toBeNull();
    expect(usageWindow(null, now)).toBeNull();
    expect(windowRefusal(null)).toBeNull();
  });

  it("refuses new starts while it would run out before resetting", async () => {
    const ws = workspace();
    usage = { window: { pct: 80, resetsIn: 7200, burnPerMin: 2, capsIn: 600 } };
    await expect(ws.start("x")).rejects.toThrow(
      /Brake: .*usage window is 80% used and at this rate runs out in 10m/
    );
    usage = {
      window: { pct: 80, resetsIn: 600, burnPerMin: 0.5, capsIn: null },
    };
    await expect(ws.start("y")).resolves.toMatch(/Started/);
  });

  it("fails closed when the window can't be read or is 15 minutes stale", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-limits-"));
    const file = path.join(dir, "limits.json");
    expect(readUsage(file, now)).toEqual({
      unknown: `the usage window can't be read (${file})`,
    });
    fs.writeFileSync(
      file,
      JSON.stringify({ window: now + 3600, samples: [[now - 16 * 60, 20]] })
    );
    expect(readUsage(file, now)).toEqual({
      unknown:
        "the usage window was last sampled 16m ago, so it can't be checked",
    });
    // Eleven minutes stale: no projection, but not unknown either.
    fs.writeFileSync(
      file,
      JSON.stringify({ window: now + 3600, samples: [[now - 11 * 60, 20]] })
    );
    expect(readUsage(file, now)).toEqual({ window: null });

    const ws = workspace();
    usage = readUsage(path.join(dir, "missing.json"), now);
    await expect(ws.start("x")).rejects.toThrow(
      /Brake: not starting a session: the usage window can't be read/
    );
    await expect(ws.start("y")).rejects.toThrow(/Brake/);
    expect(
      listNotes(ws.workspace.id).filter((n) => n.kind === "brake")
    ).toHaveLength(1);
  });
});

describe("a stack the orchestrator starts", () => {
  it("brakes every card's start, not just the stack", async () => {
    const { stackStartGate } = await import("./brakes");
    const ws = workspace();
    db.prepare(
      `UPDATE workspaces SET orch_max_starts_per_hour = 2 WHERE id = ?`
    ).run(ws.workspace.id);
    db.prepare(
      `INSERT INTO orchestrator_starts (workspace_id, kind, target, created_at) VALUES (?, 'stack', 'stack-1', ?)`
    ).run(ws.workspace.id, ago(1000));
    expect(await stackStartGate("stack-1", "card-a")).toBeNull();
    expect(await stackStartGate("stack-1", "card-b")).toBeNull();
    expect(await stackStartGate("stack-1", "card-c")).toMatch(
      /Held by the orchestrator's brakes: 2 starts in the last hour/
    );
    // A stack a person started isn't the orchestrator's to hold.
    expect(await stackStartGate("someone-elses-stack", "card-d")).toBeNull();
  });

  it("holds a braked card in the stack watcher, which starts nothing", async () => {
    const { setStartGate, tickStack } = await import("@/lib/stacks/tick");
    const { seedStack } = await import("@/lib/stacks/testing");
    const s = seedStack(fs.mkdtempSync(path.join(os.tmpdir(), "aos-stack-")), [
      { key: "A", status: "planned" },
    ]);
    const { stackQueries: q } = await import("@/lib/db");
    setStartGate(async () => "Held by the orchestrator's brakes: test");
    const start = vi.fn(async () => {});
    await tickStack(q.get(db, s.stackId)!, { start, restack: async () => {} });
    setStartGate(null);
    expect(start).not.toHaveBeenCalled();
    expect(s.item("A")).toMatchObject({
      status: "planned",
      note: "Held by the orchestrator's brakes: test",
    });
  });
});

describe("a brake on Saad's asks list", () => {
  const brakeAsks = (w: string) =>
    openAsks(w).filter((a) => a.kind === "brake");
  const fill = (ws: ReturnType<typeof workspace>) => {
    for (let i = 0; i < 4; i++) {
      const id = seedSession({ projectId: ws.api.id, name: `busy-${i}` });
      busy.add(`claude-${id}`);
    }
  };

  it("asks once while it holds, and closes the ask when it lifts", async () => {
    const ws = workspace();
    fill(ws);
    await expect(ws.start("a")).rejects.toThrow(/Brake/);
    await expect(ws.start("b")).rejects.toThrow(/Brake/);
    const asks = brakeAsks(ws.workspace.id);
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({
      subject: "brake",
      title: "New starts are braked",
    });
    expect(asks[0].detail).toMatch(/4 sessions are running/);

    busy.clear();
    await expect(ws.start("fits")).resolves.toMatch(/Started/);
    expect(brakeAsks(ws.workspace.id)).toEqual([]);
  });

  it("lets exactly one start through on approval, then asks again", async () => {
    const ws = workspace();
    fill(ws);
    await expect(ws.start("a")).rejects.toThrow(/Brake/);
    const [ask] = brakeAsks(ws.workspace.id);
    answerAsk(ws.workspace.id, ask.id, { action: "approve" });
    await expect(ws.start("approved one")).resolves.toMatch(/Started/);
    await expect(ws.start("not this one")).rejects.toThrow(/Brake/);
    const again = brakeAsks(ws.workspace.id);
    expect(again).toHaveLength(1);
    expect(again[0].id).not.toBe(ask.id);
  });

  it("binds an approval to its brake, and voids it when the brakes lift", async () => {
    const ws = workspace();
    fill(ws);
    await expect(ws.start("a")).rejects.toThrow(/4 sessions are running/);
    const [ask] = brakeAsks(ws.workspace.id);
    expect(ask.brake_key).toBe("running");
    answerAsk(ws.workspace.id, ask.id, { action: "approve" }, "running");
    // A different brake now holds: the approval for "running" doesn't wave it through.
    busy.clear();
    db.prepare(
      `UPDATE workspaces SET orch_max_starts_per_hour = 0 WHERE id = ?`
    ).run(ws.workspace.id);
    await expect(ws.start("b")).rejects.toThrow(/starts in the last hour/);
    // The brakes lift: the unspent approval is void, not saved for later.
    db.prepare(
      `UPDATE workspaces SET orch_max_starts_per_hour = 6 WHERE id = ?`
    ).run(ws.workspace.id);
    await expect(ws.start("c")).resolves.toMatch(/Started/);
    const row = db
      .prepare(`SELECT used_at, answer FROM orchestrator_asks WHERE id = ?`)
      .get(ask.id) as { used_at: string | null; answer: string };
    expect(row.used_at).toBeTruthy();
    expect(row.answer).toBe("approve (void)");
  });

  it("holds a stack it launched before Pause, in the stack watcher too", async () => {
    const { setStartGate, tickStack } = await import("@/lib/stacks/tick");
    const { seedStack } = await import("@/lib/stacks/testing");
    const { stackStartGate } = await import("./brakes");
    const { landGate } = await import("./signoff");
    const { stackQueries: q } = await import("@/lib/db");
    const ws = workspace();
    const s = seedStack(fs.mkdtempSync(path.join(os.tmpdir(), "aos-stack-")), [
      { key: "A", status: "planned" },
    ]);
    db.prepare(
      `INSERT INTO orchestrator_starts (workspace_id, kind, target, created_at) VALUES (?, 'stack', ?, ?)`
    ).run(ws.workspace.id, s.stackId, ago(1000));
    setPaused(ws.workspace.id, true);
    setStartGate(stackStartGate);
    const start = vi.fn(async () => {});
    try {
      await tickStack(q.get(db, s.stackId)!, {
        start,
        restack: async () => {},
      });
      expect(start).not.toHaveBeenCalled();
      expect(s.item("A")?.note).toMatch(/paused by Saad/);
      await expect(landGate(ws.workspace.id)("any-task")).resolves.toEqual({
        wait: "the orchestrator is paused",
      });

      setPaused(ws.workspace.id, false);
      await tickStack(q.get(db, s.stackId)!, {
        start,
        restack: async () => {},
      });
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      setStartGate(null);
    }
  });

  it("refuses every start while paused, and none of it is a brake ask", async () => {
    const ws = workspace();
    setPaused(ws.workspace.id, true);
    await expect(ws.start("x")).rejects.toThrow(/Paused by Saad/);
    const { stackStartGate } = await import("./brakes");
    db.prepare(
      `INSERT INTO orchestrator_starts (workspace_id, kind, target, created_at) VALUES (?, 'stack', 'stack-p', ?)`
    ).run(ws.workspace.id, ago(0));
    await expect(stackStartGate("stack-p", "item-1")).resolves.toMatch(
      /paused by Saad/
    );
    expect(brakeAsks(ws.workspace.id)).toEqual([]);
    setPaused(ws.workspace.id, false);
    await expect(ws.start("y")).resolves.toMatch(/Started/);
  });
});
