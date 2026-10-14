import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { createProject } from "../projects";
import { seedSession } from "../orchestrator/testing";

const available = vi.hoisted(() => ({ on: true }));
vi.mock("./available", () => ({ simulatorAvailable: () => available.on }));

import { deviceNameFor, setSimctlRunner, type SimDevice } from "./simctl";
import {
  planFinishedShutdowns,
  projectSimName,
  shutFinishedTaskSimulators,
  shutTaskSimulators,
  simSlug,
  taskDeviceNames,
} from "./task-devices";

const dev = (name: string, state = "Booted"): SimDevice => ({
  udid: `U-${name}`,
  name,
  state,
  runtime: "iOS",
});
const task = (id: string, status: string | null, branch = "feature/x") => ({
  id,
  branch_name: branch,
  worktree_path: "/wt/" + id,
  task_status: status,
  paths: ["/wt/" + id],
});
const A = "aaaaaaaa-1111";
const B = "bbbbbbbb-2222";

describe("name matching", () => {
  it("slugs a branch the way agentos-mobile does", () => {
    expect(simSlug("feature/fix-chat-chips-layout-regression-fc20b3")).toBe(
      "feature-fix-chat-chips-layout-regression"
    );
    expect(projectSimName("", "/wt/a")).toMatch(
      /^agentos-detached-[0-9a-f]{6}$/
    );
    expect(projectSimName("feature/x", "/wt/a")).toMatch(
      /^agentos-feature-x-[0-9a-f]{6}$/
    );
  });

  it("names both schemes for a task", () => {
    expect(
      taskDeviceNames({ id: A, branch_name: "feature/x" }, ["/wt/a"])
    ).toEqual([deviceNameFor(A), projectSimName("feature/x", "/wt/a")]);
    expect(taskDeviceNames({ id: A, branch_name: null }, [])).toEqual([
      deviceNameFor(A),
    ]);
  });
});

describe("only finished tasks", () => {
  const names = (ds: SimDevice[]) => ds.map((d) => d.name);

  it.each(["merged", "dropped", "done"])("shuts down for a %s task", (s) => {
    const t = task(A, s);
    const own = dev(deviceNameFor(A));
    const proj = dev(projectSimName(t.branch_name, "/wt/" + A));
    expect(names(planFinishedShutdowns([own, proj], [t]))).toEqual([
      own.name,
      proj.name,
    ]);
  });

  it.each(["running", "moving", "moved", null])("leaves a %s task's", (s) => {
    const t = task(A, s);
    expect(planFinishedShutdowns([dev(deviceNameFor(A))], [t])).toEqual([]);
  });

  it("leaves a device shared with a running task", () => {
    const done = task(A, "merged");
    const live = {
      ...task(B, "running"),
      worktree_path: done.worktree_path,
      paths: done.paths,
    };
    const shared = dev(projectSimName("feature/x", "/wt/" + A));
    expect(planFinishedShutdowns([shared], [done, live])).toEqual([]);
  });

  it("leaves shut down, unmatched and base devices alone", () => {
    const t = task(A, "merged");
    const ds = [
      dev(deviceNameFor(A), "Shutdown"),
      dev("iPhone 17"),
      dev("aos-ffffff-12345678"),
      dev("agentos-other-abc123"),
    ];
    expect(planFinishedShutdowns(ds, [t])).toEqual([]);
  });
});

describe("with simctl mocked", () => {
  const calls: string[][] = [];
  let devices: SimDevice[] = [];
  let failFirst = false;
  const project = createProject({
    name: "sim-td",
    workingDirectory: "/tmp",
  }).id;

  const seed = (status: string) => {
    const id = seedSession({ projectId: project, name: "t", task: true });
    db.prepare(
      `UPDATE sessions SET task_status = ?, branch_name = 'feature/x', worktree_path = ? WHERE id = ?`
    ).run(status, "/wt/" + id, id);
    return id;
  };

  beforeEach(() => {
    process.env.AGENTOS_SIM_SHUTDOWN = "on";
    available.on = true;
    failFirst = false;
    devices = [];
    calls.length = 0;
    setSimctlRunner(async (args) => {
      calls.push(args);
      if (args[0] === "list") {
        return JSON.stringify({
          devices: {
            "iOS 26": devices.map((d) => ({ ...d, isAvailable: true })),
          },
        });
      }
      if (args[0] === "shutdown" && failFirst) {
        failFirst = false;
        throw new Error("boom");
      }
      return "";
    });
  });
  afterEach(() => {
    process.env.AGENTOS_SIM_SHUTDOWN = "off";
    setSimctlRunner(null);
  });

  const shutdowns = () =>
    calls.filter((c) => c[0] === "shutdown").map((c) => c[1]);

  it("sweeps only finished tasks and never deletes", async () => {
    const done = seed("merged");
    const live = seed("running");
    devices = [
      dev(deviceNameFor(done)),
      dev(projectSimName("feature/x", "/wt/" + done)),
      dev(deviceNameFor(live)),
      dev("iPhone 17"),
    ];
    expect(await shutFinishedTaskSimulators()).toBe(2);
    expect(shutdowns()).toEqual([
      `U-${deviceNameFor(done)}`,
      `U-${projectSimName("feature/x", "/wt/" + done)}`,
    ]);
    expect(calls.some((c) => ["delete", "erase"].includes(c[0]))).toBe(false);
  });

  it("does nothing, quietly, without xcrun", async () => {
    available.on = false;
    seed("merged");
    expect(await shutFinishedTaskSimulators()).toBe(0);
    shutTaskSimulators({ id: A, host_id: "local" });
    expect(calls).toEqual([]);
  });

  it("keeps going when one shutdown fails", async () => {
    const a = seed("done");
    const b = seed("dropped");
    devices = [dev(deviceNameFor(a)), dev(deviceNameFor(b))];
    failFirst = true;
    expect(await shutFinishedTaskSimulators()).toBe(1);
    expect(shutdowns()).toHaveLength(2);
  });

  it("shuts a task's own devices when it ends", async () => {
    const id = seed("merged");
    devices = [dev(deviceNameFor(id)), dev(deviceNameFor(A))];
    shutTaskSimulators({
      id,
      host_id: "local",
      branch_name: "feature/x",
      worktree_path: "/wt/" + id,
    });
    await vi.waitFor(() =>
      expect(shutdowns()).toEqual([`U-${deviceNameFor(id)}`])
    );
  });

  it("does not throw into the caller when listing fails", () => {
    setSimctlRunner(async () => {
      throw new Error("no simctl");
    });
    expect(() => shutTaskSimulators({ id: A, host_id: "local" })).not.toThrow();
  });
});
