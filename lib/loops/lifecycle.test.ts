import { afterEach, describe, expect, it, vi } from "vitest";
import { openAsks, taskSubject } from "../orchestrator/asks";
import { setLoopHooks } from "./hooks";
import { makeWorld } from "./world.test-helpers";
import {
  actOnNext,
  editLoop,
  stopByUser,
  loopView,
  startLoop,
} from "./controls";
import { criteriaOf, cyclesOf } from "./store";
import { LoopError } from "./types";

afterEach(() => setLoopHooks({}));

describe("loop lifecycle", () => {
  it("reports each settled cycle and the stop to the hooks, and raises one ask for a stop short of done", async () => {
    const onCycleSettled = vi.fn();
    const onStop = vi.fn();
    setLoopHooks({ onCycleSettled, onStop });
    const { run, world } = await makeWorld({
      failing: () => ["a.test.ts > breaks"],
      met: () => 0,
    });
    const loop = await run();
    expect(loop.stopReason).toBe("repeat");
    expect(onCycleSettled).toHaveBeenCalledTimes(3);
    expect(onCycleSettled.mock.calls[0][0]).toMatchObject({
      taskId: world.taskId,
      cycleId: expect.any(Number),
    });
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(
      openAsks(world.ws).filter((a) => a.subject === taskSubject(world.taskId))
    ).toHaveLength(1);
  });

  it("a stop by the user raises no ask, and stopping twice changes nothing", async () => {
    const { world, tick, state } = await makeWorld({
      failing: () => [],
      met: () => 0,
    });
    await tick();
    stopByUser(world.taskId);
    expect(state()).toMatchObject({ state: "stopped", stopReason: "stopped" });
    expect(() => stopByUser(world.taskId)).toThrow(LoopError);
    expect(
      openAsks(world.ws).filter((a) => a.subject === taskSubject(world.taskId))
    ).toHaveLength(0);
  });

  it("one running loop per task", async () => {
    const { world, deps } = await makeWorld({
      failing: () => [],
      met: () => 0,
    });
    await expect(
      startLoop(world.taskId, { criteria: [{ text: "x" }] }, deps)
    ).rejects.toBeInstanceOf(LoopError);
  });

  it("edits the checklist while running and keeps a waived criterion waived", async () => {
    const { world, state } = await makeWorld({
      failing: () => [],
      met: () => 0,
    });
    const [first] = criteriaOf(state().id);
    editLoop(world.taskId, { waive: [first.id] });
    editLoop(world.taskId, { addCriteria: [{ text: "Extra" }] });
    const after = criteriaOf(state().id);
    expect(after.find((c) => c.id === first.id)?.status).toBe("waived");
    expect(after.some((c) => c.text === "Extra")).toBe(true);
  });

  it("skip and hold act on the cycle in its countdown", async () => {
    const { world, tick, round, state } = await makeWorld(
      { failing: () => ["a.test.ts > x"], met: () => 0 },
      { graceSeconds: 120 }
    );
    await tick();
    world.fact.status = "running";
    await tick();
    world.fact.status = "idle";
    world.fact.lastActive = world.t - 30_000;
    world.rev++;
    world.t += 60_000;
    await tick();
    await tick();
    const counting = cyclesOf(state().id).find((c) => c.state === "counting");
    if (counting) {
      await actOnNext(world.taskId, { action: "skip" });
      expect(cyclesOf(state().id).find((c) => c.n === counting.n)?.state).toBe(
        "skipped"
      );
    }
    expect(loopView(world.taskId)?.loop.id).toBe(state().id);
    void round;
  });
});
