import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { db } from "../db";
import { createProject } from "../projects";
import { createWorkspace, setProjectWorkspace } from "../workspaces";
import { nextRunAt } from "./scheduler";
import {
  archiveSchedule,
  attachSession,
  brakeRun,
  claimSlot,
  createSchedule,
  failAbandonedClaims,
  finishOneOff,
  finishRun,
  findSchedule,
  getSchedule,
  holdLease,
  lastRun,
  lastSettledBefore,
  lastStarted,
  LEASE_MS,
  listRuns,
  listSchedules,
  pauseSchedule,
  slotTaken,
  startedSessions,
  targetProblem,
  updateSchedule,
  upcomingOneOffs,
  type ScheduleInput,
} from "./store";

const at = (s: string) => Date.parse(s);
const NOW = at("2026-10-07T13:00:00Z");

function seed(over: Partial<ScheduleInput> = {}, now = NOW) {
  const ws = createWorkspace(`ws-${randomUUID().slice(0, 6)}`);
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp",
  });
  setProjectWorkspace(project.id, ws.id);
  const input: ScheduleInput = {
    workspaceId: ws.id,
    projectId: project.id,
    name: "Daily",
    cron: "0 9 * * *",
    prompt: "Do the thing",
    kind: "task",
    ...over,
  };
  return { ws, project, input, schedule: createSchedule(input, now) };
}

describe("createSchedule", () => {
  it("writes the stored row: normalized cron, default zone, armed now, enabled", () => {
    const { ws, project, schedule } = seed({
      name: "  Morning  ",
      cron: "0   9  * * *",
      prompt: " go ",
    });
    expect(schedule).toMatchObject({
      workspace_id: ws.id,
      project_id: project.id,
      name: "Morning",
      cron: "0 9 * * *",
      timezone: "America/Chicago",
      prompt: "go",
      kind: "task",
      enabled: true,
      armed_at: NOW,
      run_at: null,
      done_at: null,
      archived_at: null,
      created_by_session_id: null,
      target_session_id: null,
    });
    expect(getSchedule(schedule.id)).toEqual(schedule);
    expect(listSchedules(ws.id).map((s) => s.id)).toEqual([schedule.id]);
  });

  it("rejects bad input without writing a row", () => {
    const { ws, input } = seed();
    const bad = (over: Partial<ScheduleInput>, msg: RegExp) =>
      expect(() =>
        createSchedule({ ...input, name: "Other", ...over })
      ).toThrow(msg);
    bad({ name: " " }, /Give the schedule a name/);
    bad({ name: 'has "quotes"' }, /can't use quotes/);
    bad({ prompt: "" }, /Write the prompt/);
    bad({ timezone: "Mars/Base" }, /Unknown time zone/);
    bad({ cron: "nope" }, /./);
    bad({ cron: undefined }, /Needs a cron or a run time/);
    bad({ at: NOW + 3_600_000 }, /not both/);
    bad({ projectId: null }, /needs a project/);
    bad({ cron: "*/10 * * * *" }, /at most once an hour/);
    bad({ name: "daily" }, /already a schedule called "Daily"/);
    bad({ workspaceId: randomUUID() }, /./);
    expect(listSchedules(ws.id)).toHaveLength(1);
  });

  it("refuses a project from another workspace", () => {
    const { input } = seed();
    const other = seed();
    expect(() =>
      createSchedule({
        ...input,
        name: "Cross",
        projectId: other.project.id,
      })
    ).toThrow(/isn't in this workspace/);
  });

  it("a message schedule needs a live session in its workspace and clears the project", () => {
    const { ws, project, input } = seed();
    const sid = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id)
       VALUES (?, 'buddy', ?, '/tmp', ?)`
    ).run(sid, `claude-${sid}`, project.id);
    const msg = {
      ...input,
      name: "Ping",
      kind: "message" as const,
      cron: "*/15 * * * *",
    };
    expect(() => createSchedule(msg)).toThrow("Pick a session to message");
    expect(() =>
      createSchedule({ ...msg, targetSessionId: randomUUID() })
    ).toThrow(/session no longer exists/);
    expect(() =>
      createSchedule({ ...msg, cron: "* * * * *", targetSessionId: sid })
    ).toThrow(/at most every 10 minutes/);
    const s = createSchedule({ ...msg, targetSessionId: sid });
    expect(s).toMatchObject({
      kind: "message",
      project_id: null,
      target_session_id: sid,
      workspace_id: ws.id,
    });
    expect(targetProblem(s)).toBeNull();
    db.prepare(`UPDATE sessions SET task_status = 'merged' WHERE id = ?`).run(
      sid
    );
    expect(targetProblem(s)).toBe("session finished");
  });

  it("starts disabled when asked, and findSchedule resolves id, prefix and name", () => {
    const unique = `Nightly ${randomUUID().slice(0, 6)}`;
    const { schedule } = seed({ enabled: false, name: unique });
    expect(schedule.enabled).toBe(false);
    expect(findSchedule(schedule.id).id).toBe(schedule.id);
    expect(findSchedule(schedule.id.slice(0, 8)).id).toBe(schedule.id);
    expect(findSchedule(unique.toUpperCase()).id).toBe(schedule.id);
    seed();
    seed();
    expect(() => findSchedule("daily")).toThrow(/matches several/);
    expect(() => findSchedule("no such schedule")).toThrow(
      /No schedule called/
    );
  });
});

describe("updateSchedule", () => {
  it("a cron edit rearms from now; a name or prompt edit does not", () => {
    const { schedule } = seed();
    const later = NOW + 5 * 60_000;
    const renamed = updateSchedule(
      schedule.id,
      { name: "Renamed", prompt: "new" },
      later
    );
    expect(renamed).toMatchObject({
      name: "Renamed",
      prompt: "new",
      armed_at: NOW,
    });
    const recron = updateSchedule(schedule.id, { cron: "30 10 * * *" }, later);
    expect(recron).toMatchObject({
      cron: "30 10 * * *",
      armed_at: later,
      run_at: null,
    });
  });

  it("disabling keeps armed_at; enabling again rearms from then", () => {
    const { schedule } = seed();
    const off = updateSchedule(schedule.id, { enabled: false }, NOW + 1000);
    expect(off).toMatchObject({ enabled: false, armed_at: NOW });
    expect(nextRunAt(off, NOW)).toBeNull();
    const on = updateSchedule(schedule.id, { enabled: true }, NOW + 60_000);
    expect(on).toMatchObject({ enabled: true, armed_at: NOW + 60_000 });
  });

  it("a timezone change rearms and shifts the next run", () => {
    const { schedule } = seed({ cron: "0 9 * * *" });
    const ny = updateSchedule(
      schedule.id,
      { timezone: "America/New_York" },
      NOW
    );
    expect(ny.timezone).toBe("America/New_York");
    expect(nextRunAt(ny, NOW)).toBe(at("2026-10-08T13:00:00Z"));
    expect(nextRunAt(schedule, NOW)).toBe(at("2026-10-07T14:00:00Z"));
  });

  it("refuses an unknown, archived or clashing schedule, and leaves the row", () => {
    const a = seed();
    expect(() => updateSchedule(randomUUID(), { name: "x" })).toThrow(
      "Schedule not found"
    );
    const b = createSchedule({ ...a.input, name: "Second" }, NOW);
    expect(() => updateSchedule(b.id, { name: "daily" })).toThrow(
      /already a schedule/
    );
    expect(getSchedule(b.id)?.name).toBe("Second");
    archiveSchedule(b.id);
    expect(() => updateSchedule(b.id, { name: "z" })).toThrow(
      "Schedule not found"
    );
  });

  it("switching between a cron and a one-off swaps which column is set", () => {
    const { schedule } = seed();
    const when = at("2026-10-09T15:00:00Z");
    const once = updateSchedule(schedule.id, { at: when }, NOW);
    expect(once).toMatchObject({ run_at: when, cron: "" });
    const back = updateSchedule(schedule.id, { cron: "0 9 * * *" }, NOW);
    expect(back).toMatchObject({ run_at: null, cron: "0 9 * * *" });
  });
});

describe("archiveSchedule", () => {
  it("removes it from the list, disables it, and keeps its runs", () => {
    const { ws, schedule } = seed();
    const run = claimSlot(schedule.id, "slot-1", NOW, "schedule")!;
    finishRun(run, "started", null, "s1");
    archiveSchedule(schedule.id);
    expect(listSchedules(ws.id)).toEqual([]);
    const row = getSchedule(schedule.id)!;
    expect(row.enabled).toBe(false);
    expect(row.archived_at).not.toBeNull();
    expect(listRuns(schedule.id)).toHaveLength(1);
  });
});

describe("next run in America/Chicago", () => {
  const daily = (now: number) => seed({ cron: "0 9 * * *" }, now).schedule;

  it("is 9:00 local today when it hasn't passed, else tomorrow", () => {
    const before = at("2026-10-07T13:00:00Z"); // 8:00 CDT
    expect(nextRunAt(daily(before), before)).toBe(at("2026-10-07T14:00:00Z"));
    const after = at("2026-10-07T15:00:00Z"); // 10:00 CDT
    expect(nextRunAt(daily(after), after)).toBe(at("2026-10-08T14:00:00Z"));
  });

  it("keeps 9:00 local across spring-forward (UTC-6 to UTC-5)", () => {
    const now = at("2026-03-07T16:00:00Z"); // 10:00 CST, day before
    const s = daily(now);
    expect(nextRunAt(s, now)).toBe(at("2026-03-08T14:00:00Z")); // 9:00 CDT
  });

  it("keeps 9:00 local across fall-back (UTC-5 to UTC-6)", () => {
    const now = at("2026-10-31T16:00:00Z"); // 11:00 CDT, day before
    const s = daily(now);
    expect(nextRunAt(s, now)).toBe(at("2026-11-01T15:00:00Z")); // 9:00 CST
  });

  it("a 2:30 schedule runs once, an hour on, on the skipped spring morning", () => {
    const now = at("2026-03-08T06:00:00Z"); // midnight CST
    const s = seed(
      { cron: "30 2 * * *", kind: "orchestrator", projectId: null },
      now
    ).schedule;
    expect(nextRunAt(s, now)).toBe(at("2026-03-08T08:30:00Z")); // 3:30 CDT
  });

  it("counts from armed_at when that is later than now", () => {
    const s = daily(NOW);
    expect(nextRunAt(s, NOW - 86_400_000)).toBe(at("2026-10-07T14:00:00Z"));
  });

  it("a different zone on the same cron is a different instant", () => {
    const { schedule } = seed({ timezone: "UTC" });
    expect(nextRunAt(schedule, NOW)).toBe(at("2026-10-08T09:00:00Z"));
  });
});

describe("one-off schedules", () => {
  const WHEN = at("2026-10-08T15:00:00Z");

  it("stores run_at with an empty cron, and reads its text in the zone", () => {
    const num = seed({ cron: undefined, at: WHEN }).schedule;
    expect(num).toMatchObject({ cron: "", run_at: WHEN, done_at: null });
    const text = seed({ cron: undefined, at: "2026-12-01 09:00" }).schedule;
    expect(text.run_at).toBe(at("2026-12-01T15:00:00Z")); // CST
    const summer = seed({ cron: undefined, at: "2026-10-20 09:00" }).schedule;
    expect(summer.run_at).toBe(at("2026-10-20T14:00:00Z")); // CDT
  });

  it("refuses a past time and one over a year out", () => {
    const base = seed().input;
    const one = (when: number) =>
      createSchedule({ ...base, name: "x", cron: undefined, at: when }, NOW);
    expect(() => one(NOW - 1)).toThrow(/has passed/);
    expect(() => one(NOW)).toThrow(/has passed/);
    expect(() => one(NOW + 367 * 86_400_000)).toThrow(/at most a year ahead/);
    expect(() => one(NOW + 86_400_000)).not.toThrow();
  });

  it("its next run is its run_at until it is done, then none", () => {
    const { schedule, ws } = seed({ cron: undefined, at: WHEN });
    expect(nextRunAt(schedule, NOW)).toBe(WHEN);
    expect(upcomingOneOffs(ws.id).map((s) => s.id)).toEqual([schedule.id]);
    expect(finishOneOff(schedule.id, WHEN + 1000)).toBe(true);
    expect(finishOneOff(schedule.id, WHEN + 2000)).toBe(false);
    const done = getSchedule(schedule.id)!;
    expect(done).toMatchObject({ enabled: false, done_at: WHEN + 1000 });
    expect(nextRunAt(done, NOW)).toBeNull();
    expect(upcomingOneOffs(ws.id)).toEqual([]);
  });

  it("moving a done one-off to a new time opens it again", () => {
    const { schedule } = seed({ cron: undefined, at: WHEN });
    finishOneOff(schedule.id, WHEN + 1000);
    const later = at("2026-10-10T15:00:00Z");
    const again = updateSchedule(schedule.id, { at: later }, WHEN + 5000);
    expect(again).toMatchObject({
      run_at: later,
      done_at: null,
      enabled: true,
      armed_at: WHEN + 5000,
    });
  });

  it("an agent's reminder needs the minimum lead time", () => {
    const { input } = seed();
    const sid = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, 'agent', ?, '/tmp')`
    ).run(sid, `claude-${sid}`);
    const remind = (when: number) =>
      createSchedule(
        {
          ...input,
          name: `r${when}`,
          kind: "orchestrator",
          projectId: null,
          cron: undefined,
          at: when,
          createdBySessionId: sid,
        },
        NOW
      );
    expect(() => remind(NOW + 60_000)).toThrow(/at least 10 minutes ahead/);
    expect(remind(NOW + 11 * 60_000).created_by_session_id).toBe(sid);
  });
});

describe("run history", () => {
  const slot = "2026-10-07T14:00:00.000Z";

  it("a slot is claimed once; the row is the lock", () => {
    const { schedule } = seed();
    expect(slotTaken(schedule.id, slot)).toBe(false);
    const id = claimSlot(schedule.id, slot, at(slot), "schedule");
    expect(id).toBeTypeOf("number");
    expect(claimSlot(schedule.id, slot, at(slot), "catch-up")).toBeNull();
    expect(slotTaken(schedule.id, slot)).toBe(true);
    expect(listRuns(schedule.id)).toHaveLength(1);
    expect(lastRun(schedule.id)).toMatchObject({
      id,
      slot,
      slot_at: at(slot),
      trigger: "schedule",
      outcome: "claimed",
      detail: null,
      session_id: null,
    });
  });

  it("finishRun records the outcome, caps detail and keeps an attached session", () => {
    const { schedule } = seed();
    const id = claimSlot(schedule.id, slot, at(slot), "manual")!;
    attachSession(id, "sess-1");
    finishRun(id, "failed", "x".repeat(900));
    const r = lastRun(schedule.id)!;
    expect(r).toMatchObject({
      outcome: "failed",
      session_id: "sess-1",
      trigger: "manual",
    });
    expect(r.detail).toHaveLength(500);
    finishRun(id, "started", null, "sess-2");
    expect(lastRun(schedule.id)).toMatchObject({
      outcome: "started",
      session_id: "sess-2",
      detail: null,
    });
    attachSession(id, "late");
    expect(lastRun(schedule.id)?.session_id).toBe("sess-2");
  });

  it("lists newest first, and finds the last started and last settled before a run", () => {
    const { schedule } = seed();
    const run = (i: number, outcome: "started" | "failed" | "skipped") => {
      const id = claimSlot(schedule.id, `s${i}`, NOW + i, "schedule")!;
      finishRun(id, outcome, null, outcome === "started" ? `sess-${i}` : null);
      return id;
    };
    const r1 = run(1, "started");
    const r2 = run(2, "failed");
    const r3 = run(3, "skipped");
    const r4 = run(4, "started");
    expect(listRuns(schedule.id).map((r) => r.id)).toEqual([r4, r3, r2, r1]);
    expect(listRuns(schedule.id, 2)).toHaveLength(2);
    expect(lastStarted(schedule.id, r4)?.id).toBe(r1);
    expect(lastSettledBefore(schedule.id, r4)?.id).toBe(r2);
    expect(lastSettledBefore(schedule.id, r2)?.id).toBe(r1);
    expect(lastSettledBefore(schedule.id, r1)).toBeNull();
    expect(startedSessions(schedule.id)).toEqual(["sess-4", "sess-1"]);
  });

  it("a braked run frees its slot, and claiming it again reuses the row", () => {
    const { schedule } = seed();
    const id = claimSlot(schedule.id, slot, at(slot), "schedule")!;
    brakeRun(id, "paused");
    expect(lastRun(schedule.id)).toMatchObject({
      outcome: "skipped",
      detail: "paused",
      slot: `braked:${slot}`,
    });
    expect(slotTaken(schedule.id, slot)).toBe(false);
    const again = claimSlot(schedule.id, slot, at(slot), "catch-up");
    expect(again).toBe(id);
    expect(listRuns(schedule.id)).toHaveLength(1);
    expect(lastRun(schedule.id)).toMatchObject({
      slot,
      outcome: "claimed",
      trigger: "catch-up",
      detail: null,
    });
    brakeRun(id + 999, "nothing");
  });

  it("failAbandonedClaims fails old claims, counts a started one, and closes a one-off", () => {
    const { schedule } = seed();
    const bare = claimSlot(schedule.id, "a", NOW, "schedule")!;
    const withSession = claimSlot(schedule.id, "b", NOW, "schedule")!;
    attachSession(withSession, "sess-x");
    const once = seed({
      cron: undefined,
      at: at("2026-10-08T15:00:00Z"),
    }).schedule;
    claimSlot(once.id, "o", NOW, "schedule");
    const future = Date.now() + 10 * 60_000;
    expect(failAbandonedClaims(60_000, Date.now())).toBe(0);
    expect(failAbandonedClaims(60_000, future)).toBeGreaterThanOrEqual(3);
    const byId = new Map(listRuns(schedule.id).map((r) => [r.id, r]));
    expect(byId.get(bare)).toMatchObject({ outcome: "failed" });
    expect(byId.get(bare)?.detail).toMatch(/interrupted/);
    expect(byId.get(withSession)).toMatchObject({
      outcome: "started",
      session_id: "sess-x",
    });
    expect(getSchedule(once.id)).toMatchObject({ enabled: false });
    expect(getSchedule(once.id)?.done_at).toBe(future);
    expect(getSchedule(schedule.id)?.done_at).toBeNull();
  });
});

describe("pauseSchedule and the scheduler lease", () => {
  it("pauses once: only the first call reports it", () => {
    const { schedule } = seed();
    expect(pauseSchedule(schedule.id)).toBe(true);
    expect(pauseSchedule(schedule.id)).toBe(false);
    expect(getSchedule(schedule.id)?.enabled).toBe(false);
  });

  it("one process holds the lease until its heartbeat goes stale", () => {
    const t = Date.now() + 10_000_000;
    const a = `a-${randomUUID()}`;
    const b = `b-${randomUUID()}`;
    // Take it over from whoever held it before this test.
    expect(holdLease(a, process.pid, t)).toBe(true);
    expect(holdLease(a, process.pid, t + 1000)).toBe(true);
    expect(holdLease(b, process.pid, t + 2000)).toBe(false);
    expect(holdLease(b, process.pid, t + 1000 + LEASE_MS + 1)).toBe(true);
    expect(holdLease(a, process.pid, t + 1000 + LEASE_MS + 2)).toBe(false);
  });
});
