import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedSession, seedWorkspace } from "@/lib/orchestrator/testing";
import { updateWorkspace } from "@/lib/workspaces";
import { resetMachineStarts } from "@/lib/load/start-gate";
import type { MachineView } from "./schedule";

const released: string[] = [];
vi.mock("@/lib/chat/runner", () => ({
  chatState: () => "idle",
  chatStateNow: () => "idle",
  releaseChat: async (id: string) => void released.push(id),
  stopChat: () => undefined,
}));
vi.mock("@/lib/chat/stop", () => ({
  stopChatAtTurnEnd: async () => ({ stopped: true }),
  stopChatTurn: async () => ({ stopped: true }),
}));
vi.mock("@/lib/chat/worker/client", () => ({
  waitForExit: async () => undefined,
}));

const view = (level: "green" | "red"): MachineView => ({
  label: "this machine",
  enabled: true,
  reading: false,
  level,
  settled: true,
  settleLeftMs: 0,
  booted: 0,
  maxBooted: 2,
  heavyStarting: 0,
  lastAutoStartAt: null,
  lastHeavyStartAt: null,
});
let machine = view("green");
vi.mock("@/lib/load/machines", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/load/machines")>()),
  localView: () => machine,
  machineCapabilities: () => ["mac"],
  recordAutoStart: () => undefined,
}));
vi.mock("@/lib/hosts/peer-load", () => ({
  peerReading: () => null,
  peerSource: () => null,
  refreshPeers: async () => undefined,
}));

const { requestPause, resumeNow, sweepPauses } = await import("./pause");
const { setPaused } = await import("@/lib/orchestrator/pause");
const { tickOnce } = await import("./queue");
const { runTool } = await import("@/lib/orchestrator/serve");
const { ensureOrchestrator } = await import("@/lib/orchestrator/home");

const settle = () => new Promise((r) => setTimeout(r, 20));
const sess = (id: string) =>
  db
    .prepare(`SELECT pause_state, pause_note FROM sessions WHERE id = ?`)
    .get(id) as { pause_state: string | null; pause_note: string | null };

// A workspace at its limit of 3 running tasks, one of them paused (and so
// not counted) and a second one taking its slot back.
async function fullWorkspace() {
  const t = seedWorkspace();
  ensureOrchestrator(t.workspace.id);
  updateWorkspace(t.workspace.id, { maxRunningTasks: 3 });
  const paused = seedSession({
    projectId: t.app.id,
    name: "paused one",
    view: "chat",
    task: true,
  });
  for (const name of ["a", "b"])
    seedSession({ projectId: t.app.id, name, view: "chat", task: true });
  requestPause(paused, { until: null, by: "orchestrator" });
  await settle();
  return { ...t, paused };
}

beforeEach(() => {
  machine = view("green");
  resetMachineStarts();
  db.prepare(`UPDATE task_pauses SET state = 'ended'`).run();
  released.length = 0;
});

describe("resuming a paused task with every slot taken", () => {
  it("the orchestrator's resume starts it at once, past the limit", async () => {
    const t = await fullWorkspace();
    const said = await runTool(t.workspace.id, "resume_task", {
      task: t.paused,
    });
    expect(said).toMatch(
      /Resumed paused one now past the running-task limit \(3 of 3 running\)/
    );
    expect(sess(t.paused).pause_state).toBe("resuming");
    expect(released).toContain(t.paused);
  });

  it("a person's resume starts it at once too", async () => {
    const t = await fullWorkspace();
    expect(await resumeNow(t.paused, "person")).toEqual({
      outcome: "resumed",
    });
    expect(released).toContain(t.paused);
  });

  it("a red machine holds it, says why, and it goes when the load calms", async () => {
    const t = await fullWorkspace();
    machine = view("red");
    const said = await runTool(t.workspace.id, "resume_task", {
      task: t.paused,
    });
    expect(said).toMatch(/held: this machine load red/);
    expect(sess(t.paused)).toMatchObject({
      pause_state: "paused",
      pause_note: "held: this machine load red",
    });
    await tickOnce();
    expect(released).not.toContain(t.paused);
    machine = view("green");
    await tickOnce();
    expect(released).toContain(t.paused);
    expect(sess(t.paused).pause_note).toBeNull();
  });
});

describe("while the orchestrator is paused", () => {
  it("holds the orchestrator's resume, says why, and lets it go when unpaused", async () => {
    const t = await fullWorkspace();
    setPaused(t.workspace.id, true);
    const out = await resumeNow(t.paused, "orchestrator");
    expect(out).toEqual({
      outcome: "held",
      note: "held: the orchestrator is paused",
    });
    expect(sess(t.paused).pause_note).toBe("held: the orchestrator is paused");
    await tickOnce();
    expect(released).not.toContain(t.paused);
    setPaused(t.workspace.id, false);
    await tickOnce();
    expect(released).toContain(t.paused);
    expect(sess(t.paused).pause_note).toBeNull();
  });

  it("doesn't hold a resume by a person", async () => {
    const t = await fullWorkspace();
    setPaused(t.workspace.id, true);
    expect(await resumeNow(t.paused, "person")).toEqual({
      outcome: "resumed",
    });
    expect(released).toContain(t.paused);
  });
});

describe("a timed resume", () => {
  it("waits for a slot and says where it stands", async () => {
    const t = await fullWorkspace();
    db.prepare(
      `UPDATE task_pauses SET until_at = datetime('now', '-1 minute') WHERE session_id = ?`
    ).run(t.paused);
    await sweepPauses();
    await tickOnce();
    expect(released).not.toContain(t.paused);
    expect(sess(t.paused)).toMatchObject({
      pause_state: "paused",
      pause_note: "resuming: waiting for a slot, 3 of 3 running",
    });
  });

  it("starts once a slot frees", async () => {
    const t = await fullWorkspace();
    db.prepare(
      `UPDATE task_pauses SET until_at = datetime('now', '-1 minute') WHERE session_id = ?`
    ).run(t.paused);
    await sweepPauses();
    await tickOnce();
    expect(released).not.toContain(t.paused);
    db.prepare(
      `UPDATE sessions SET task_status = 'merged' WHERE name = 'a'`
    ).run();
    await tickOnce();
    expect(released).toContain(t.paused);
    expect(sess(t.paused).pause_note).toBeNull();
  });
});
