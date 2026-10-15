import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db, insertSessionRow, updateSessionRow, type Session } from "../../db";
import { createHost } from "../../hosts";
import { saveHostLink } from "../../hosts/remote-api";
import { createProject } from "../../projects";
import { createWorkspace, setProjectWorkspace } from "../../workspaces";
import { seedOrchestrator } from "../../orchestrator/testing";
import { pendingEvents } from "../../orchestrator/events";
import { setPaused } from "../../orchestrator/pause";
import type { MachineView } from "../schedule";
import { json, row, setupMoveRepo, type MoveFixture } from "../move-testing";

const greenView = (): MachineView => ({
  label: "this machine",
  enabled: true,
  reading: false,
  level: "green",
  settled: true,
  settleLeftMs: 0,
  booted: 0,
  maxBooted: 2,
  heavyStarting: 0,
  lastAutoStartAt: null,
  lastHeavyStartAt: null,
});
let machine = greenView();
let capabilities = ["mac", "xcode", "simulator"];
vi.mock("@/lib/load/machines", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/load/machines")>()),
  localView: () => machine,
  machineCapabilities: () => capabilities,
}));

// The ordinary move, standing in: it gives back the row a move would leave.
const moved: { id: string; to: string }[] = [];
vi.mock("@/lib/tasks/move-flow", () => ({
  moveTask: async (id: string, to: string) => {
    moved.push({ id, to });
    const arrived = randomUUID();
    insertSessionRow(db, {
      id: arrived,
      name: "arrived",
      tmux_name: `claude-${arrived}`,
      working_directory: "/tmp",
      task_status: "running",
      plan_phase: "awaiting",
    });
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    return db
      .prepare(`SELECT * FROM session_rows WHERE id = ?`)
      .get(arrived) as Session;
  },
}));

const implemented: { id: string; message?: string }[] = [];
vi.mock("@/lib/models/plan-step", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/models/plan-step")>()),
  implementArrived: async (id: string, message?: string) => {
    implemented.push({ id, message });
    return "anthropic/implement";
  },
}));

const pushed: string[] = [];
vi.mock("@/lib/notify/push/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notify/push/events")>()),
  pushPlanAwaiting: (id: string) => {
    pushed.push(id);
  },
}));

const { mirrorTask } = await import("./start");
const { forget: forgetHostTasks } = await import("./client");
const { TASK_CAPABILITIES } = await import("./types");
const { handoffHome } = await import("./plan");
const { remotePlanPath } = await import("./plan-path");
const { syncMirrors: syncRemotePlans } = await import("./sync");
const { approvePlan } = await import("../../models/plan-step");

let f: MoveFixture;
let hostId: string;
let workspaceId: string;
let orchestratorId: string;
const fetchMock = vi.fn();
const calls: { url: string; method: string; body: unknown }[] = [];
// What the other machine answers: whether its plan is written, and the text.
let planReady = true;
let planText: string | null = "# Plan\n\n- change a\n- change b\n";

const PLAN_IN_PIECES = `${"# Plan\n\n- change a\n"}
## Pieces
1. App part: the first slice  (repo: app)
2. Other part: the second slice  (repo: other)
   after: 1 is deployed
   why split: (a) + (b)
`;

function mirror(over: { planOnly?: boolean; orchestrated?: boolean } = {}) {
  const id = randomUUID();
  const remote = {
    id,
    name: "Plan it",
    tmux_name: `claude-${id}`,
    working_directory: "/home/alice/.agent-os/worktrees/app-x",
    worktree_path: "/home/alice/.agent-os/worktrees/app-x",
    model: "sonnet",
    branch_name: "feature/x",
    base_branch: "main",
    task_prompt: "do x",
    view: "chat",
  } as Partial<Session> as Session;
  mirrorTask(hostId, f.projectId, remote, null);
  updateSessionRow(db, id, {
    plan_phase: "planning",
    plan_only: over.planOnly ? 1 : null,
    plan_decided: 1,
    plan_waits_for_caller: 1,
    started_by: over.orchestrated ? orchestratorId : null,
  });
  return id;
}

beforeAll(() => {
  f = setupMoveRepo();
  hostId = createHost("devbox", "alice@devbox").id;
  saveHostLink(hostId, "http://devbox:3011", "secret-token");
  vi.stubGlobal("fetch", fetchMock);
  workspaceId = createWorkspace(`ws-${randomUUID().slice(0, 6)}`).id;
  setProjectWorkspace(f.projectId, workspaceId);
  const other = createProject({
    name: "other",
    workingDirectory: "/tmp/other",
  });
  setProjectWorkspace(other.id, workspaceId);
  orchestratorId = randomUUID();
  seedOrchestrator(orchestratorId);
  process.env.AGENTOS_PLANS_DIR = path.join(f.tmp, "plans");
});
afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENTOS_PLANS_DIR;
  f.restore();
});
beforeEach(() => {
  calls.length = 0;
  moved.length = 0;
  implemented.length = 0;
  pushed.length = 0;
  machine = greenView();
  capabilities = ["mac", "xcode", "simulator"];
  planReady = true;
  planText = "# Plan\n\n- change a\n- change b\n";
  forgetHostTasks(hostId);
  fs.rmSync(path.join(f.repo, "ios"), { recursive: true, force: true });
  db.prepare(`UPDATE projects SET machine_needs = NULL WHERE id = ?`).run(
    f.projectId
  );
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const id = /\/api\/tasks\/([^/]+)\//.exec(url)?.[1];
    if (url.endsWith("/plan"))
      return json({ text: planText, phase: "awaiting" });
    if (url.endsWith("/approve-plan"))
      return json({ success: true, model: "anthropic/opus" });
    if (url.endsWith("/api/tasks"))
      return json({
        tasks: planReady ? [{ id: id ?? "", planReady: true }] : [],
        moved: [],
        capabilities: [...TASK_CAPABILITIES],
      });
    return json({ error: "unexpected" }, 500);
  });
});

// The list answers with every mirror; a test's task is the one it asks about.
const listing = (ids: string[]) =>
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.endsWith("/plan"))
      return json({ text: planText, phase: "awaiting" });
    if (url.endsWith("/approve-plan"))
      return json({ success: true, model: "anthropic/opus" });
    return json({
      tasks: planReady ? ids.map((id) => ({ id, planReady: true })) : [],
      moved: [],
      capabilities: [...TASK_CAPABILITIES],
    });
  });

const approvals = () => calls.filter((c) => c.url.endsWith("/approve-plan"));
const eventLines = (key: string) =>
  pendingEvents(workspaceId).filter((e) => e.key.endsWith(key));

describe("a plan written on a linked machine", () => {
  it("is copied here, announced once with this machine's path, and waits for approval when plan-only", async () => {
    const id = mirror({ planOnly: true, orchestrated: true });
    listing([id]);
    await syncRemotePlans();
    await syncRemotePlans();
    expect(row(id).plan_phase).toBe("awaiting");
    expect(fs.readFileSync(remotePlanPath(id), "utf8")).toBe(planText);
    const lines = eventLines(`plan-done:${id}`);
    expect(lines).toHaveLength(1);
    expect(lines[0].line).toContain(remotePlanPath(id));
    expect(lines[0].line).not.toContain("/home/alice");
    expect(lines[0].line).toContain("waiting for approval");
    expect(row(id).plan_note).toBe(lines[0].line);
    expect(approvals()).toEqual([]);
    expect(pushed).toEqual([id]);
  });

  it("is left alone while it is still being written there", async () => {
    const id = mirror({ planOnly: true });
    planReady = false;
    listing([id]);
    await syncRemotePlans();
    expect(row(id).plan_phase).toBe("planning");
    expect(calls.some((c) => c.url.endsWith("/plan"))).toBe(false);
  });

  it("goes on at once for a plan-first task whose work needs nothing more: approved where it planned", async () => {
    const id = mirror({ orchestrated: true });
    listing([id]);
    await syncRemotePlans();
    expect(approvals()).toHaveLength(1);
    expect(approvals()[0].url).toContain(`/api/tasks/${id}/approve-plan`);
    expect(row(id).plan_phase).toBe("implementing");
    expect(eventLines(`plan-done:${id}`)[0].line).toContain(
      "implementing on devbox"
    );
    expect(moved).toEqual([]);
    expect(pushed).toEqual([]);
  });

  it("comes home to be built when it needs a Mac, once this machine is calm", async () => {
    fs.mkdirSync(path.join(f.repo, "ios", "App.xcodeproj"), {
      recursive: true,
    });
    const id = mirror();
    listing([id]);
    machine = { ...greenView(), level: "red", settled: false };
    await syncRemotePlans();
    expect(row(id).plan_phase).toBe("handoff");
    expect(approvals()).toEqual([]);
    expect(moved).toEqual([]);
    // Calm again: the next look moves it and starts the build.
    machine = greenView();
    await syncRemotePlans();
    await vi.waitFor(() => expect(implemented).toHaveLength(1));
    expect(moved).toEqual([{ id, to: "local" }]);
    expect(implemented[0].id).not.toBe(id);
    expect(approvals()).toEqual([]);
  });

  it("never moves home while this machine can't take the work", async () => {
    fs.mkdirSync(path.join(f.repo, "ios", "App.xcodeproj"), {
      recursive: true,
    });
    const id = mirror();
    listing([id]);
    machine = { ...greenView(), level: "red", settled: false };
    await syncRemotePlans();
    await syncRemotePlans();
    await syncRemotePlans();
    expect(moved).toEqual([]);
    expect(row(id).plan_phase).toBe("handoff");
  });

  it("comes home when the plan is in pieces: they register on this machine", async () => {
    planText = PLAN_IN_PIECES;
    const id = mirror();
    listing([id]);
    machine = { ...greenView(), level: "red", settled: false };
    await syncRemotePlans();
    expect(row(id).plan_phase).toBe("handoff");
    expect(approvals()).toEqual([]);
  });

  it("approving a waiting plan sends the change to the machine that planned it", async () => {
    const id = mirror({ planOnly: true });
    listing([id]);
    await syncRemotePlans();
    const ref = await approvePlan(id, "also cover b", async () => {});
    expect(ref.ref).toBe("anthropic/opus");
    expect(approvals()).toHaveLength(1);
    expect(approvals()[0].body).toEqual({ message: "also cover b" });
    expect(row(id).plan_phase).toBe("implementing");
  });

  it("approving a Mac task's plan holds the change for the move home", async () => {
    fs.mkdirSync(path.join(f.repo, "ios", "App.xcodeproj"), {
      recursive: true,
    });
    const id = mirror({ planOnly: true });
    listing([id]);
    await syncRemotePlans();
    machine = { ...greenView(), level: "red", settled: false };
    await approvePlan(id, "also cover b", async () => {});
    expect(row(id).plan_phase).toBe("handoff");
    expect(row(id).plan_handoff_message).toBe("also cover b");
    machine = greenView();
    await syncRemotePlans();
    await vi.waitFor(() => expect(implemented).toHaveLength(1));
    expect(implemented).toEqual([
      { id: expect.any(String), message: "also cover b" },
    ]);
  });

  it("stays put while the orchestrator is paused", async () => {
    fs.mkdirSync(path.join(f.repo, "ios", "App.xcodeproj"), {
      recursive: true,
    });
    const id = mirror({ orchestrated: true });
    listing([id]);
    machine = { ...greenView(), level: "red", settled: false };
    await syncRemotePlans();
    machine = greenView();
    setPaused(workspaceId, true);
    try {
      await handoffHome(id);
      expect(moved).toEqual([]);
    } finally {
      setPaused(workspaceId, false);
    }
    await handoffHome(id);
    expect(moved).toHaveLength(1);
  });

  it("finishes implementing a task that arrived but never started, after a restart", async () => {
    const arrived = randomUUID();
    insertSessionRow(db, {
      id: arrived,
      name: "arrived",
      tmux_name: `claude-${arrived}`,
      working_directory: "/tmp",
      task_status: "running",
      plan_phase: "awaiting",
      plan_handoff_message: "also cover b",
    });
    await syncRemotePlans();
    await vi.waitFor(() => expect(implemented).toHaveLength(1));
    expect(implemented[0]).toEqual({ id: arrived, message: "also cover b" });
    await vi.waitFor(() =>
      expect(row(arrived).plan_handoff_message).toBeNull()
    );
  });

  it("leaves the arrived hand-off marker until implementing has started", async () => {
    const id = mirror();
    updateSessionRow(db, id, { plan_phase: "handoff" });
    await handoffHome(id);
    expect(implemented).toHaveLength(1);
    expect(row(implemented[0].id).plan_handoff_message).toBeNull();
  });
});
