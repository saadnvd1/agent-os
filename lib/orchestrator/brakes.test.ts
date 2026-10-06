import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db";
import { seedSession, seedWorkspace } from "./testing";
import type { UsageWindow } from "./usage";

// Sessions named "busy-*" are working; the rest are idle.
const busy = new Set<string>();
let window: UsageWindow | null = null;

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
  readUsageWindow: () => window,
}));

const { db } = await import("@/lib/db");
const { ensureOrchestrator } = await import("./home");
const { runTool } = await import("./serve");
const { listNotes } = await import("./notes");
const { usageWindow, windowRefusal } = await import("./usage");

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-brakes-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
beforeEach(() => {
  busy.clear();
  window = null;
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
    window = { pct: 80, resetsIn: 7200, burnPerMin: 2, capsIn: 600 };
    await expect(ws.start("x")).rejects.toThrow(
      /Brake: .*usage window is 80% used and at this rate runs out in 10m/
    );
    window = { pct: 80, resetsIn: 600, burnPerMin: 0.5, capsIn: null };
    await expect(ws.start("y")).resolves.toMatch(/Started/);
  });
});
