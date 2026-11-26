import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db";
import { db, insertSessionRow, updateSessionRow } from "@/lib/db";
import { seedWorkspace } from "@/lib/orchestrator/testing";
import { resetMachineStarts } from "@/lib/load/start-gate";
import { updateWorkspace } from "@/lib/workspaces";
import type { MachineView } from "./schedule";

// The machines a start was sent to, in order (undefined: this one).
const startedOn: (string | undefined)[] = [];
// Linked machines whose clone can't resolve the base.
let lacksBase = new Set<string>();
let peers: string[] = [];

vi.mock("@/lib/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks")>()),
  createTask: async (o: {
    id?: string;
    projectId: string;
    hostId?: string;
  }) => {
    startedOn.push(o.hostId);
    if (o.hostId && lacksBase.has(o.hostId))
      throw new Error(
        `${o.hostId}: Failed to create worktree: git worktree add failed: fatal: invalid reference: feature/chat-integrations`
      );
    insertSessionRow(db, {
      id: o.id as string,
      name: "t",
      tmux_name: `claude-${o.id}`,
      working_directory: "/tmp",
      project_id: o.projectId,
      task_status: "running",
      branch_name: "feature/x",
    });
    return { id: o.id, name: "t", branch_name: "feature/x" } as Session;
  },
}));

vi.mock("@/lib/orchestrator/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/usage")>()),
  readUsage: () => ({ window: null }),
  windowRefusal: () => null,
}));

const view = (level: "green" | "red"): MachineView => ({
  label: "this machine",
  enabled: true,
  reading: false,
  level,
  settled: level === "green",
  settleLeftMs: 0,
  booted: 0,
  maxBooted: 2,
  heavyStarting: 0,
  lastAutoStartAt: null,
  lastHeavyStartAt: null,
});
let machine = view("red");
vi.mock("@/lib/load/machines", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/load/machines")>()),
  localView: () => machine,
  machineCapabilities: () => ["mac", "xcode", "simulator"],
  recordAutoStart: () => {},
}));
vi.mock("@/lib/hosts/remote-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts/remote-api")>()),
  linkedHostIds: () => new Set(peers),
  hostLink: (id: string) => (peers.includes(id) ? { hostId: id } : null),
}));
vi.mock("@/lib/tasks/contract/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks/contract/client")>()),
  list: async () => ({ tasks: [], capabilities: ["held-start"] }),
}));
vi.mock("@/lib/hosts/project-machines", () => ({
  projectMachines: async () => Object.fromEntries(peers.map((p) => [p, null])),
}));
vi.mock("@/lib/hosts/peer-load", () => ({
  refreshPeers: async (ids: string[], now: number) => {
    const { feedGate } = await import("@/lib/load/start-gate");
    for (const id of ids) feedGate(id, "green", now);
  },
  peerReading: () => ({ load1: 1, cores: 8, level: "green" }),
  peerSource: (id: string) => ({
    hostId: id,
    label: id,
    level: "green",
    booted: 0,
    maxBooted: 2,
    capabilities: ["linux"],
    stale: false,
  }),
}));

const { queueIfNeeded, tickQueue } = await import("./queue");
const { forgetBaseMisses } = await import("./base-misses");

const rowOf = (id: string) =>
  db
    .prepare(`SELECT status, attempts, error FROM task_queue WHERE id = ?`)
    .get(id) as { status: string; attempts: number; error: string | null };

async function tick() {
  await tickQueue();
  await tickQueue();
}

function queue(baseBranch = "feature/chat-integrations") {
  const t = seedWorkspace();
  updateWorkspace(t.workspace.id, { maxRunningTasks: null });
  const q = queueIfNeeded({
    startedVia: "person",
    projectId: t.app.id,
    prompt: "work on it",
    baseBranch,
    after: t.task,
  })!;
  updateSessionRow(db, t.task, { task_status: "merged" });
  return q.id;
}

beforeEach(() => {
  startedOn.length = 0;
  lacksBase = new Set();
  peers = [];
  machine = view("red");
  resetMachineStarts();
  db.prepare(`UPDATE task_queue SET status = 'removed'`).run();
});

describe("a placed start whose machine can't resolve the base", () => {
  it("moves to another machine without spending an attempt", async () => {
    peers = ["box", "box2"];
    lacksBase = new Set(["box", "box2"]);
    const id = queue();
    lacksBase.delete("box2");
    // Whichever is tried first, the one that lacks the base is never tried twice.
    await tick();
    await tick();
    const tried = startedOn.filter(Boolean);
    expect(rowOf(id).status).toBe("started");
    expect(rowOf(id).attempts).toBe(0);
    expect(tried[tried.length - 1]).toBe("box2");
    expect(tried.filter((h) => h === "box").length).toBeLessThanOrEqual(1);
    forgetBaseMisses(id);
  });

  it("stays queued with a clear reason when no other machine can take it", async () => {
    peers = ["box"];
    lacksBase = new Set(["box"]);
    const id = queue();
    await tick();
    await tick();
    await tick();
    expect(startedOn.filter(Boolean)).toEqual(["box"]);
    const row = rowOf(id);
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(0);
    expect(row.error).toMatch(
      /box couldn't find base feature\/chat-integrations/
    );
    forgetBaseMisses(id);
  });

  it("starts here once this machine has room", async () => {
    peers = ["box"];
    lacksBase = new Set(["box"]);
    const id = queue();
    await tick();
    machine = view("green");
    await tick();
    expect(rowOf(id).status).toBe("started");
    expect(startedOn[startedOn.length - 1]).toBeUndefined();
  });
});
