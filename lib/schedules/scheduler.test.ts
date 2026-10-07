import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../db";
import {
  createWorkspace,
  deleteWorkspace,
  setProjectWorkspace,
} from "../workspaces";
import { createProject } from "../projects";
import { setPaused } from "../orchestrator/pause";
import { Braked, runSlot, type RunDeps } from "./run";
import { dueSlot, tick } from "./scheduler";
import {
  createSchedule,
  failAbandonedClaims,
  claimSlot,
  findSchedule,
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
  return { ws, project, schedule };
}

// Records what started; a run counts as working while `busy` holds it.
function fakeDeps() {
  const started: string[] = [];
  const busy = new Set<string>();
  const notified: string[] = [];
  const deps: RunDeps = {
    start: async (s, onSession) => {
      const id = `session-${started.length + 1}`;
      onSession(id);
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

  it("never runs a slot from before it was created", () => {
    const { schedule } = seed("0 7 * * *");
    // 7:00 CDT today came before the 8:00 creation.
    expect(dueSlot(schedule, at("2026-10-07T13:30:00Z"))).toBeNull();
  });

  it("an edited time counts from the edit, not from creation", () => {
    const { schedule } = seed("0 9 * * *");
    // 8:15 CDT is after creation (8:00) but before the edit (9:30).
    const edited = updateSchedule(
      schedule.id,
      { cron: "15 8 * * *" },
      at("2026-10-07T14:30:00Z")
    );
    expect(dueSlot(edited, at("2026-10-07T14:31:00Z"))).toBeNull();
    // A prompt edit doesn't re-arm.
    const prompt = updateSchedule(
      schedule.id,
      { prompt: "Something else" },
      at("2026-10-07T15:00:00Z")
    );
    expect(prompt.armed_at).toBe(edited.armed_at);
  });

  it("a disabled schedule never runs, and re-enabling counts from then", async () => {
    const { schedule } = seed();
    const { deps, started } = fakeDeps();
    updateSchedule(schedule.id, { enabled: false }, at("2026-10-07T13:01:00Z"));
    await tick(deps, at("2026-10-07T13:05:01Z"));
    expect(mine(schedule, started)).toHaveLength(0);
    const on = updateSchedule(
      schedule.id,
      { enabled: true },
      at("2026-10-07T13:10:30Z")
    );
    // 13:10 was before the re-enable: not owed.
    expect(dueSlot(on, at("2026-10-07T13:10:40Z"))).toBeNull();
    await tick(deps, at("2026-10-07T13:11:01Z"));
    expect(listRuns(schedule.id).map((r) => r.slot)).toEqual([
      "2026-10-07T13:11:00.000Z",
    ]);
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

  it("skips when it can't tell whether the last run is working", async () => {
    const { schedule } = seed();
    const { deps, started } = fakeDeps();
    await tick(deps, at("2026-10-07T13:05:01Z"));
    deps.stillRunning = async () => {
      throw new Error("tmux unreadable");
    };
    await tick(deps, at("2026-10-07T13:06:01Z"));
    expect(mine(schedule, started)).toHaveLength(1);
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "skipped",
      detail: "couldn't check the last run: tmux unreadable",
    });
  });

  it("Run now goes while the last run is still working", async () => {
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

describe("brakes", () => {
  it("a braked run is skipped with the reason, and retried next tick in the same row", async () => {
    const { schedule } = seed("0 9 * * *");
    const { deps, started } = fakeDeps();
    const real = deps.start;
    let held = true;
    deps.start = async (s, on) => {
      if (held) throw new Braked("2 sessions are running, at the limit of 2");
      return real(s, on);
    };
    // 9:00 CDT, then three more ticks while braked.
    for (const t of ["14:00:01", "14:01:01", "14:02:01"])
      await tick(deps, at(`2026-10-07T${t}Z`));
    expect(mine(schedule, started)).toHaveLength(0);
    let runs = listRuns(schedule.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      outcome: "skipped",
      detail: "braked: 2 sessions are running, at the limit of 2",
      slot: "braked:2026-10-07T14:00:00.000Z",
    });
    // The brake lifts: the same slot runs once, in the same row.
    held = false;
    await tick(deps, at("2026-10-07T14:03:01Z"));
    await tick(deps, at("2026-10-07T14:04:01Z"));
    expect(mine(schedule, started)).toHaveLength(1);
    runs = listRuns(schedule.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      outcome: "started",
      slot: "2026-10-07T14:00:00.000Z",
    });
  });

  it("a braked slot isn't owed once a newer one is due", async () => {
    const { schedule } = seed("0 * * * *");
    const { deps, started } = fakeDeps();
    const real = deps.start;
    let held = true;
    deps.start = async (s, on) => {
      if (held) throw new Braked("starts limit");
      return real(s, on);
    };
    await tick(deps, at("2026-10-07T14:00:01Z"));
    held = false;
    await tick(deps, at("2026-10-07T15:00:01Z"));
    expect(mine(schedule, started)).toHaveLength(1);
    expect(listRuns(schedule.id).map((r) => [r.slot, r.outcome])).toEqual([
      ["2026-10-07T15:00:00.000Z", "started"],
      ["braked:2026-10-07T14:00:00.000Z", "skipped"],
    ]);
  });

  it("Run now obeys them, and isn't retried", async () => {
    const { schedule } = seed();
    const { deps, started, notified } = fakeDeps();
    deps.start = async () => {
      throw new Braked("the usage window runs out before it resets");
    };
    const r = await runSlot(schedule, Date.now(), "manual", deps);
    expect(r).toMatchObject({
      outcome: "skipped",
      detail: "braked: the usage window runs out before it resets",
    });
    expect(mine(schedule, started)).toHaveLength(0);
    expect(notified).toEqual([]);
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

  it("holds a run paused while it checked the last one", async () => {
    const { ws, schedule } = seed();
    const { deps, started } = fakeDeps();
    await tick(deps, at("2026-10-07T13:05:01Z"));
    deps.stillRunning = async () => {
      setPaused(ws.id, true);
      return false;
    };
    await tick(deps, at("2026-10-07T13:06:01Z"));
    expect(mine(schedule, started)).toHaveLength(1);
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "skipped",
      detail: "paused with the orchestrator",
    });
    setPaused(ws.id, false);
  });

  it("holds Run now too", async () => {
    const { ws, schedule } = seed();
    const { deps, started } = fakeDeps();
    setPaused(ws.id, true);
    const r = await runSlot(schedule, Date.now(), "manual", deps);
    expect(r).toMatchObject({
      outcome: "skipped",
      detail: "paused with the orchestrator",
    });
    expect(mine(schedule, started)).toHaveLength(0);
    setPaused(ws.id, false);
  });

  it("holds a catch-up, and says it was one", async () => {
    const { ws, schedule } = seed("0 * * * *");
    const { deps, started } = fakeDeps();
    setPaused(ws.id, true);
    const boot = at("2026-10-07T17:20:00Z");
    await tick(deps, boot, boot - 1000);
    expect(mine(schedule, started)).toHaveLength(0);
    expect(listRuns(schedule.id)[0]).toMatchObject({
      trigger: "catch-up",
      outcome: "skipped",
      detail: "caught up: paused with the orchestrator",
    });
    setPaused(ws.id, false);
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

  it("a project moved to another workspace fails, notifying once", async () => {
    const { project, schedule } = seed();
    const { deps, started, notified } = fakeDeps();
    const elsewhere = createWorkspace(`ws-${randomUUID().slice(0, 6)}`);
    setProjectWorkspace(project.id, elsewhere.id);
    await tick(deps, at("2026-10-07T13:05:01Z"));
    await tick(deps, at("2026-10-07T13:06:01Z"));
    expect(mine(schedule, started)).toHaveLength(0);
    expect(listRuns(schedule.id).map((r) => r.outcome)).toEqual([
      "failed",
      "failed",
    ]);
    expect(listRuns(schedule.id)[0].detail).toMatch(/moved out/);
    expect(notified).toHaveLength(1);
  });

  it("a crash after the session started keeps the run, so overlap still sees it", async () => {
    const { schedule } = seed();
    const { deps, started, busy } = fakeDeps();
    // Starts its session, then the process dies before the run is recorded.
    let reached = () => {};
    const started_ = new Promise<void>((r) => (reached = r));
    deps.start = (_s, onSession) => {
      onSession("session-crash");
      reached();
      return new Promise<string>(() => {});
    };
    void tick(deps, at("2026-10-07T13:05:01Z"));
    await started_;
    failAbandonedClaims(-5000);
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "started",
      session_id: "session-crash",
    });
    // After the restart, the next slot sees that session still working.
    busy.add("session-crash");
    const after = fakeDeps();
    after.deps.stillRunning = deps.stillRunning;
    await tick(after.deps, at("2026-10-07T13:06:01Z"));
    expect(mine(schedule, [...started, ...after.started])).toHaveLength(0);
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "skipped",
      detail: "still running",
    });
  });

  it("a deleted project or workspace fails, notifying once", async () => {
    const a = seed();
    const b = seed();
    const { deps, started, notified } = fakeDeps();
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(a.project.id);
    deleteWorkspace(b.ws.id);
    await tick(deps, at("2026-10-07T13:05:01Z"));
    await tick(deps, at("2026-10-07T13:06:01Z"));
    expect(mine(a.schedule, started)).toHaveLength(0);
    expect(mine(b.schedule, started)).toHaveLength(0);
    expect(listRuns(a.schedule.id)[0]).toMatchObject({
      outcome: "failed",
      detail: "Its project no longer exists",
    });
    expect(listRuns(b.schedule.id)[0]).toMatchObject({
      outcome: "failed",
      detail: "Its workspace no longer exists",
    });
    expect(notified.sort()).toEqual([
      "Its project no longer exists",
      "Its workspace no longer exists",
    ]);
  });

  it("a start that fails after making its session keeps the link", async () => {
    const { schedule } = seed();
    const { deps } = fakeDeps();
    deps.start = async (_s, onSession) => {
      onSession("session-half");
      throw new Error("tmux timed out");
    };
    await tick(deps, at("2026-10-07T13:05:01Z"));
    expect(listRuns(schedule.id)[0]).toMatchObject({
      outcome: "failed",
      detail: "tmux timed out",
      session_id: "session-half",
    });
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

describe("findSchedule", () => {
  it("finds by id, a 6+ character id prefix, or name", () => {
    const { schedule } = seed();
    const named = updateSchedule(schedule.id, {
      name: `Unique ${randomUUID().slice(0, 6)}`,
    });
    expect(findSchedule(named.id).id).toBe(named.id);
    expect(findSchedule(named.id.slice(0, 6)).id).toBe(named.id);
    expect(() => findSchedule(named.id.slice(0, 5))).toThrow(/No schedule/);
    expect(findSchedule(named.name.toUpperCase()).id).toBe(named.id);
  });

  it("refuses a name two workspaces share, and archived schedules", async () => {
    // Every seed is called "Nightly".
    seed();
    seed();
    expect(() => findSchedule("nightly")).toThrow(/matches several/);
    const { schedule } = seed();
    const gone = updateSchedule(schedule.id, {
      name: `Gone ${randomUUID().slice(0, 6)}`,
    });
    const { archiveSchedule } = await import("./store");
    archiveSchedule(gone.id);
    expect(() => findSchedule(gone.name)).toThrow(/No schedule called/);
  });
});
