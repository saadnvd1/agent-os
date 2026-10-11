import { describe, expect, it } from "vitest";
import type { Session } from "../db";
import { refreshSettings, setRefreshSettings } from "./refresh";
import { roleExtras } from "./worker/extras";
import { parseFreshStart } from "@/components/Workspaces/fresh-start";

const task = (over: Partial<Session> = {}) =>
  ({
    role: null,
    task_brief: "Build the thing",
    task_status: "running",
    ...over,
  }) as Session;

describe("fresh-start settings", () => {
  it("are on at 200k for orchestrators and off for tasks by default", async () => {
    expect(refreshSettings()).toEqual({
      orchestratorTokens: 200_000,
      taskTokens: 0,
      staleCompactTokens: 150_000,
    });
    expect((await roleExtras(task())).refresh).toBeUndefined();
  });

  it("give a running task's chat its threshold once switched on", async () => {
    setRefreshSettings({ taskTokens: 150_000 });
    try {
      expect((await roleExtras(task())).refresh).toEqual({
        atTokens: 150_000,
        role: "task",
      });
      expect(
        (await roleExtras(task({ task_status: "merged" }))).refresh
      ).toBeUndefined();
    } finally {
      setRefreshSettings({ taskTokens: 0 });
    }
  });

  it("refuse a threshold out of range, saving nothing", () => {
    for (const bad of [10_000, 1_000_000, 150_000.5, "200000", -1])
      expect(() =>
        setRefreshSettings({
          orchestratorTokens: 300_000,
          taskTokens: bad as number,
        })
      ).toThrow(/off or between 50k and 900k/);
    expect(refreshSettings().orchestratorTokens).toBe(200_000);
    setRefreshSettings({ orchestratorTokens: 0 });
    expect(refreshSettings().orchestratorTokens).toBe(0);
    setRefreshSettings({ orchestratorTokens: 200_000 });
  });

  it("save the stale-compact threshold, 0 for off, in the same range", () => {
    setRefreshSettings({ staleCompactTokens: 0 });
    expect(refreshSettings().staleCompactTokens).toBe(0);
    expect(() => setRefreshSettings({ staleCompactTokens: 10_000 })).toThrow(
      /off or between/
    );
    setRefreshSettings({ staleCompactTokens: 150_000 });
    expect(refreshSettings().staleCompactTokens).toBe(150_000);
  });

  it("are typed in thousands in Settings", () => {
    expect(parseFreshStart(true, "200")).toEqual({ tokens: 200_000 });
    expect(parseFreshStart(false, "nope")).toEqual({ tokens: 0 });
    expect(parseFreshStart(true, "20")).toHaveProperty("error");
    expect(parseFreshStart(true, "")).toHaveProperty("error");
  });
});
