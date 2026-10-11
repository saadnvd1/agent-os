import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { createWorkspace, setProjectWorkspace } from "../workspaces";
import { createProject } from "../projects";
import { setPaused } from "../orchestrator/pause";
import { Braked, runSlot, slotKey, type RunDeps } from "./run";
import { dueSlot, nextRunAt, tick } from "./scheduler";
import {
  claimSlot,
  createSchedule,
  failAbandonedClaims,
  findSchedule,
  listRuns,
  updateSchedule,
  upcomingOneOffs,
  type Schedule,
  type ScheduleInput,
} from "./store";
import { runNow, scheduleView } from "./index";
import { scheduledMessage } from "./start";

const mine = (s: Schedule, started: string[]) =>
  started.filter((x) => x.startsWith(`${s.id}:`));
const at = (s: string) => Date.parse(s);
const CREATED = at("2026-10-07T13:00:00Z");
const RUN_AT = at("2026-10-08T15:00:00Z");

function seed(over: Partial<ScheduleInput> = {}) {
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
      name: "Once",
      at: RUN_AT,
      prompt: "Do the thing",
      kind: "orchestrator",
      ...over,
    },
    CREATED
  );
  return { ws, project, schedule };
}

function fakeDeps() {
  const started: string[] = [];
  const deps: RunDeps = {
    start: async (s, onSession) => {
      const id = `session-${started.length + 1}`;
      onSession(id);
      started.push(`${s.id}:${id}`);
      return id;
    },
    stillRunning: async () => false,
    notify: () => {},
  };
  return { deps, started };
}

describe("creating a one-off", () => {
  it("stores the instant, no cron, and shows in its zone", () => {
    const { schedule } = seed({
      at: "2026-10-08T10:00",
      timezone: "America/Chicago",
    });
    expect(schedule).toMatchObject({
      run_at: RUN_AT,
      cron: "",
      done_at: null,
      enabled: true,
    });
    expect(scheduleView(schedule)).toMatchObject({
      oneOff: true,
      nextRunAt: RUN_AT,
      createdBy: { kind: "saad" },
    });
    expect(scheduleView(schedule).description).toMatch(/^Once, .*10:00/);
  });

  it("works for every kind", () => {
    const { ws, project } = seed();
    for (const kind of ["task", "session", "orchestrator"] as const)
      expect(
        createSchedule(
          {
            workspaceId: ws.id,
            projectId: kind === "orchestrator" ? undefined : project.id,
            name: `k-${kind}`,
            at: RUN_AT,
            prompt: "x",
            kind,
          },
          CREATED
        ).run_at
      ).toBe(RUN_AT);
  });

  it("refuses a past time, both a cron and a time, and neither", () => {
    expect(() => seed({ at: CREATED - 1000 })).toThrow(/passed/);
    expect(() => seed({ at: "yesterday" })).toThrow(/Can't read/);
    expect(() => seed({ cron: "* * * * *" })).toThrow(/not both/);
    expect(() => seed({ at: undefined })).toThrow(/cron or a run time/);
    expect(() => seed({ at: CREATED + 400 * 86_400_000 })).toThrow(/ahead/);
  });

  it("an agent's reminder must be 10 minutes ahead", () => {
    const { ws } = seed();
    const orch = (n: number) =>
      createSchedule(
        {
          workspaceId: ws.id,
          name: `r${n}`,
          at: CREATED + n * 60_000,
          prompt: "x",
          kind: "orchestrator",
          createdBySessionId: null,
        },
        CREATED
      );
    const agent = (mins: number) => () =>
      createSchedule(
        {
          workspaceId: ws.id,
          name: `a${mins}`,
          at: CREATED + mins * 60_000,
          prompt: "x",
          kind: "orchestrator",
          createdBySessionId: "some-agent-session",
        },
        CREATED
      );
    expect(orch(2).run_at).toBe(CREATED + 120_000);
    expect(agent(3)).toThrow(/at least 10 minutes/);
    expect(agent(10)().run_at).toBe(CREATED + 600_000);
  });

  it("a restart mid-claim finishes the one-off", () => {
    const { schedule } = seed();
    expect(
      claimSlot(schedule.id, slotKey(RUN_AT), RUN_AT, "schedule")
    ).not.toBeNull();
    failAbandonedClaims(0, Date.now() + 5000);
    const after = findSchedule(schedule.id);
    expect(after.done_at).not.toBeNull();
    expect(after.enabled).toBe(false);
    expect(upcomingOneOffs(schedule.workspace_id)).toHaveLength(0);
  });
});

describe("running a one-off", () => {
  it("is not due before its time and runs once at it, then turns itself off", async () => {
    const { schedule } = seed();
    const { deps, started } = fakeDeps();
    expect(dueSlot(schedule, RUN_AT - 1)).toBeNull();
    await tick(deps, RUN_AT - 60_000);
    expect(mine(schedule, started)).toHaveLength(0);

    await tick(deps, RUN_AT + 5000);
    await tick(deps, RUN_AT + 65_000);
    expect(mine(schedule, started)).toHaveLength(1);

    const after = findSchedule(schedule.id);
    expect(after.enabled).toBe(false);
    expect(after.done_at).not.toBeNull();
    expect(nextRunAt(after)).toBeNull();
    expect(upcomingOneOffs(after.workspace_id)).toHaveLength(0);
    const runs = listRuns(schedule.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: "schedule", outcome: "started" });
  });

  it("never runs twice however many ticks see it", async () => {
    const { schedule } = seed();
    const { deps, started } = fakeDeps();
    await Promise.all([
      tick(deps, RUN_AT + 1000),
      tick(deps, RUN_AT + 1000),
      tick(deps, RUN_AT + 1000),
    ]);
    expect(mine(schedule, started)).toHaveLength(1);
  });

  it("runs on return after downtime, marked caught up", async () => {
    const { schedule } = seed();
    const { deps, started } = fakeDeps();
    const back = RUN_AT + 3 * 3_600_000;
    await tick(deps, back, back - 1000);
    expect(mine(schedule, started)).toHaveLength(1);
    expect(listRuns(schedule.id)[0].trigger).toBe("catch-up");
    expect(findSchedule(schedule.id).done_at).not.toBeNull();
  });

  it("Run now uses up its one run: it then can't run again", async () => {
    const { schedule } = seed();
    const { deps, started } = fakeDeps();
    const result = await runNow(schedule.id, deps);
    expect(result.outcome).toBe("started");
    expect(findSchedule(schedule.id).done_at).not.toBeNull();
    await expect(runNow(schedule.id, deps)).rejects.toThrow(/already ran/);
    await tick(deps, RUN_AT + 1000);
    expect(mine(schedule, started)).toHaveLength(1);
  });

  it("is held while its orchestrator is paused, and runs after Resume as caught up", async () => {
    const { ws, schedule } = seed();
    const { deps, started } = fakeDeps();
    setPaused(ws.id, true);
    await tick(deps, RUN_AT + 1000);
    await tick(deps, RUN_AT + 61_000);
    expect(mine(schedule, started)).toHaveLength(0);
    expect(findSchedule(schedule.id).done_at).toBeNull();
    expect(findSchedule(schedule.id).enabled).toBe(true);

    setPaused(ws.id, false);
    await tick(deps, RUN_AT + 3_600_000, RUN_AT + 1000);
    expect(mine(schedule, started)).toHaveLength(1);
    expect(findSchedule(schedule.id).done_at).not.toBeNull();
  });

  it("a braked run stays due and finishes once it starts", async () => {
    const { schedule } = seed();
    let brake = true;
    const started: string[] = [];
    const deps: RunDeps = {
      start: async (_s, onSession) => {
        if (brake) throw new Braked("spend ceiling");
        onSession("s1");
        started.push("s1");
        return "s1";
      },
      stillRunning: async () => false,
      notify: () => {},
    };
    const first = await runSlot(schedule, RUN_AT, "schedule", deps);
    expect(first?.outcome).toBe("skipped");
    expect(findSchedule(schedule.id).done_at).toBeNull();
    brake = false;
    await tick(deps, RUN_AT + 61_000);
    expect(started).toEqual(["s1"]);
    expect(findSchedule(schedule.id).done_at).not.toBeNull();
  });

  it("a failed run is still done, and stays in history", async () => {
    const { schedule } = seed();
    const deps: RunDeps = {
      start: async () => {
        throw new Error("boom");
      },
      stillRunning: async () => false,
      notify: () => {},
    };
    await tick(deps, RUN_AT + 1000);
    expect(findSchedule(schedule.id).done_at).not.toBeNull();
    expect(listRuns(schedule.id)[0].outcome).toBe("failed");
  });
});

describe("editing a one-off", () => {
  it("a new time reopens a done one and runs it again", async () => {
    const { schedule } = seed();
    const { deps, started } = fakeDeps();
    await tick(deps, RUN_AT + 1000);
    const later = Date.now() + 86_400_000;
    const reopened = updateSchedule(schedule.id, { at: later });
    expect(reopened).toMatchObject({
      enabled: true,
      done_at: null,
      run_at: later,
    });
    expect(dueSlot(reopened, later + 1000)).toBe(later);
    await tick(deps, later + 1000);
    expect(mine(schedule, started)).toHaveLength(2);
  });

  it("renaming a done one doesn't need a future time and keeps it done", async () => {
    const { schedule } = seed();
    await tick(fakeDeps().deps, RUN_AT + 1000);
    const renamed = updateSchedule(schedule.id, { name: "Renamed" });
    expect(renamed).toMatchObject({ name: "Renamed", enabled: false });
    expect(renamed.done_at).not.toBeNull();
  });

  it("switching to a cron makes it recurring", () => {
    const { schedule } = seed();
    const recurring = updateSchedule(schedule.id, { cron: "0 9 * * *" });
    expect(recurring).toMatchObject({
      run_at: null,
      done_at: null,
      cron: "0 9 * * *",
    });
  });

  it("a done one-off frees its name", async () => {
    const { ws, schedule } = seed();
    await tick(fakeDeps().deps, RUN_AT + 1000);
    expect(
      createSchedule(
        {
          workspaceId: ws.id,
          name: schedule.name,
          at: RUN_AT,
          prompt: "x",
          kind: "orchestrator",
        },
        CREATED
      ).run_at
    ).toBe(RUN_AT);
  });
});

describe("the prompt it arrives as", () => {
  const s = { name: "R", prompt: "check PR", run_at: RUN_AT } as Pick<
    Schedule,
    "name" | "prompt" | "run_at"
  >;
  it("is never an approval", () => {
    expect(
      scheduledMessage(s, null, {
        id: "abcdef123",
        name: "Orchestrator",
        role: "orchestrator",
      })
    ).toMatch(/reminder you set yourself.*not an approval/);
    expect(scheduledMessage(s, null, null)).toMatch(
      /one-off reminder.*not an approval/
    );
    expect(
      scheduledMessage(s, null, { id: "abcdef123", name: "other" })
    ).toMatch(/peer's request, not an approval/);
  });
});
