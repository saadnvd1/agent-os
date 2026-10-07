import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { createWorkspace, setProjectWorkspace } from "../workspaces";
import { createProject } from "../projects";
import { setPaused } from "../orchestrator/pause";
import { runSlot, type RunDeps } from "./run";
import { dueSlot, tick } from "./scheduler";
import {
  createSchedule,
  failAbandonedClaims,
  claimSlot,
  listRuns,
  updateSchedule,
  type Schedule,
} from "./store";

const at = (s: string) => Date.parse(s);
// Created at 8:00 CDT on Oct 7; runs every minute unless told otherwise.
const CREATED = at("2026-10-07T13:00:00Z");

function seed(cron = "* * * * *", kind: Schedule["kind"] = "task") {
  const ws = createWorkspace(`ws-${randomUUID().slice(0, 6)}`);
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp",
  });
  setProjectWorkspace(project.id, ws.id);
  const schedule = createSchedule(
    {
      workspaceId: ws.id,
      projectId: project.id,
      name: "Nightly",
      cron,
      prompt: "Do the thing",
      kind,
    },
    CREATED
  );
  return { ws, schedule };
}

// Records what started; a run counts as working while `busy` holds it.
function fakeDeps() {
  const started: string[] = [];
  const busy = new Set<string>();
  const notified: string[] = [];
  const deps: RunDeps = {
    start: async (s) => {
      const id = `session-${started.length + 1}`;
      started.push(`${s.id}:${id}`);
      return id;
    },
    stillRunning: async (_s, run) => busy.has(run.session_id ?? ""),
    notify: (_s, why) => notified.push(why),
  };
  return { deps, started, busy, notified };
}

const mine = (s: Schedule, started: string[]) =>
  started.filter((x) => x.startsWith(`${s.id}:`));

describe("slot claiming", () => {
  it("runs a slot once however many ticks see it", async () => {
    const { schedule } = seed();
    const { deps, started } = fakeDeps();
    const now = at("2026-10-07T13:05:10Z");
    const results = await Promise.all([tick(deps, now), tick(deps, now)]);
    expect(mine(schedule, started)).toHaveLength(1);
    expect(results.flat().filter((r) => r.outcome === "started")).toHaveLength(
      1
    );
    await tick(deps, now + 20_000);
    expect(mine(schedule, started)).toHaveLength(1);
    const runs = listRuns(schedule.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      slot: "2026-10-07T13:05:00.000Z",
      trigger: "schedule",
      outcome: "started",
      session_id: "session-1",
    });
  });

  it("a taken slot can't be claimed again", () => {
    const { schedule } = seed();
    expect(claimSlot(schedule.id, "s", 1, "schedule")).not.toBeNull();
    expect(claimSlot(schedule.id, "s", 1, "schedule")).toBeNull();
  });

  it("runs the next slot on the next minute", async () => {
    const { schedule } = seed();
    const { deps, started } = fakeDeps();
    await tick(deps, at("2026-10-07T13:05:01Z"));
    await tick(deps, at("2026-10-07T13:06:01Z"));
    expect(mine(schedule, started)).toHaveLength(2);
    expect(listRuns(schedule.id).map((r) => r.slot)).toEqual([
      "2026-10-07T13:06:00.000Z",
      "2026-10-07T13:05:00.000Z",
    ]);
  });

  it("never runs a slot from before it was created or re-armed", () => {
    const { schedule } = seed("0 9 * * *");
    // 7:59 CDT, before the first 9:00 after creation.
    expect(dueSlot(schedule, at("2026-10-07T12:59:00Z"))).toBeNull();
    const edited = updateSchedule(
      schedule.id,
      { cron: "0 7 * * *" },
      at("2026-10-07T14:30:00Z")
    );
    // 7:00 today passed before the edit: not missed.
    expect(dueSlot(edited, at("2026-10-07T14:31:00Z"))).toBeNull();
  });
});

describe("catch-up", () => {
  it("runs only the most recent missed slot, once, as caught up", async () => {
    const { schedule } = seed("0 * * * *");
    const { deps, started } = fakeDeps();
    // Down from 8:00 to 12:20 CDT: 9, 10, 11 and 12 o'clock were missed.
    const boot = at("2026-10-07T17:20:00Z");
    await tick(deps, boot);
    await tick(deps, boot + 60_000);
    await tick(deps, boot + 120_000);
    expect(mine(schedule, started)).toHaveLength(1);
    const runs = listRuns(schedule.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      slot: "2026-10-07T17:00:00.000Z",
      trigger: "catch-up",
      outcome: "started",
      detail: "caught up",
    });
  });

  it("a slot from before the server started is caught up, however recent", async () => {
    const { schedule } = seed("0 * * * *");
    const { deps } = fakeDeps();
    // Back up at 10:00:40, 40s after the 10:00 slot it missed.
    const boot = at("2026-10-07T15:00:40Z");
    await tick(deps, boot, boot - 1000);
    expect(listRuns(schedule.id)[0]).toMatchObject({
      slot: "2026-10-07T15:00:00.000Z",
      trigger: "catch-up",
      detail: "caught up",
    });
  });

  it("an on-time slot isn't called caught up", async () => {
    const { schedule } = seed("0 * * * *");
    const { deps } = fakeDeps();
    await tick(deps, at("2026-10-07T14:00:30Z"));
    expect(listRuns(schedule.id)[0].trigger).toBe("schedule");
  });
});

describe("overlap", () => {
  it("skips while the last run is still working, and records it", async () => {
    const { schedule } = seed();
    const { deps, started, busy } = fakeDeps();
    await tick(deps, at("2026-10-07T13:05:01Z"));
    busy.add("session-1");
    await tick(deps, at("2026-10-07T13:06:01Z"));
    expect(mine(schedule, started)).toHaveLength(1);
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "skipped",
      detail: "still running",
      session_id: "session-1",
    });
    busy.delete("session-1");
    await tick(deps, at("2026-10-07T13:07:01Z"));
    expect(mine(schedule, started)).toHaveLength(2);
  });

  it("Run now goes anyway", async () => {
    const { schedule } = seed();
    const { deps, started, busy } = fakeDeps();
    await tick(deps, at("2026-10-07T13:05:01Z"));
    busy.add("session-1");
    const r = await runSlot(schedule, Date.now(), "manual", deps);
    expect(r?.outcome).toBe("started");
    expect(mine(schedule, started)).toHaveLength(2);
    expect(listRuns(schedule.id)[0].slot).toMatch(/^manual:/);
  });
});

describe("pause", () => {
  it("a paused orchestrator pauses its workspace's schedules", async () => {
    const { ws, schedule } = seed();
    const { deps, started } = fakeDeps();
    setPaused(ws.id, true);
    await tick(deps, at("2026-10-07T13:05:01Z"));
    expect(mine(schedule, started)).toHaveLength(0);
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "skipped",
      detail: "paused with the orchestrator",
    });
    // Resume: the next slot runs; the skipped one isn't owed.
    setPaused(ws.id, false);
    await tick(deps, at("2026-10-07T13:05:30Z"));
    expect(mine(schedule, started)).toHaveLength(0);
    await tick(deps, at("2026-10-07T13:06:01Z"));
    expect(mine(schedule, started)).toHaveLength(1);
  });

  it("only its own workspace", async () => {
    const a = seed();
    const b = seed();
    const { deps, started } = fakeDeps();
    setPaused(a.ws.id, true);
    await tick(deps, at("2026-10-07T13:05:01Z"));
    expect(mine(a.schedule, started)).toHaveLength(0);
    expect(mine(b.schedule, started)).toHaveLength(1);
  });
});

describe("failures", () => {
  it("records why and notifies", async () => {
    const { schedule } = seed();
    const { deps, notified } = fakeDeps();
    deps.start = async () => {
      throw new Error("No project called x");
    };
    await tick(deps, at("2026-10-07T13:05:01Z"));
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "failed",
      detail: "No project called x",
    });
    expect(notified).toEqual(["No project called x"]);
  });

  it("a claim left by a crash is recorded as failed", () => {
    const { schedule } = seed();
    claimSlot(schedule.id, "crashed", 1, "schedule");
    failAbandonedClaims(-5000);
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "failed",
      detail: expect.stringMatching(/interrupted/),
    });
  });
});

describe("validation", () => {
  it("refuses a bad cron, a missing project, and a project elsewhere", () => {
    const { ws } = seed();
    const base = {
      workspaceId: ws.id,
      name: "x",
      prompt: "p",
      kind: "task" as const,
    };
    expect(() => createSchedule({ ...base, cron: "nope" })).toThrow(/5 fields/);
    expect(() => createSchedule({ ...base, cron: "* * * * *" })).toThrow(
      /needs a project/
    );
    const other = seed();
    expect(() =>
      createSchedule({
        ...base,
        cron: "* * * * *",
        projectId: other.schedule.project_id,
      })
    ).toThrow(/isn't in this workspace/);
    expect(
      createSchedule({ ...base, cron: "0 9 * * *", kind: "orchestrator" }).kind
    ).toBe("orchestrator");
  });
});
