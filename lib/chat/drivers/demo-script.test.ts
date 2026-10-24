import { describe, expect, it } from "vitest";
import type { DriverEvent } from "../events";
import {
  MAX_HOLD_S,
  parseDemoScript,
  runDemoScript,
  type ScriptRun,
} from "./demo-script";

function harness(stopAfter?: (e: DriverEvent) => boolean) {
  const events: DriverEvent[] = [];
  let stopped = false;
  const run: ScriptRun = {
    push: (e) => {
      events.push(e);
      if (stopAfter?.(e)) stopped = true;
    },
    stopped: () => stopped,
    sleep: async () => {},
  };
  return { events, run };
}

const tools = (events: DriverEvent[]) =>
  events.flatMap((e) =>
    e.type === "item" && e.item.kind === "tool" ? [e.item] : []
  );

describe("parseDemoScript", () => {
  it("reads the trigger, a phase and a hold, capped", () => {
    expect(parseDemoScript("demo: running turn")).toEqual({
      phase: undefined,
      holdMs: 30_000,
    });
    expect(parseDemoScript(" demo: running turn wait hold=5 ")).toEqual({
      phase: "wait",
      holdMs: 5000,
    });
    expect(parseDemoScript("demo: running turn step hold=9999")?.holdMs).toBe(
      MAX_HOLD_S * 1000
    );
  });

  it("ignores anything else a visitor types", () => {
    for (const t of [
      "hello",
      "demo: running turn now",
      "please demo: running turn",
      "demo: running turn hold=x",
    ])
      expect(parseDemoScript(t), t).toBeNull();
  });
});

describe("runDemoScript", () => {
  it("streams a running step's output, then finishes the step and the turn", async () => {
    const { events, run } = harness();
    await runDemoScript({ phase: "step", holdMs: 2000 }, run, "t");
    const steps = tools(events);
    expect(steps.at(0)?.status).toBe("running");
    const growing = steps.filter((s) => s.status === "running");
    expect(growing.length).toBeGreaterThan(1);
    expect(growing.at(-1)!.output!.length).toBeGreaterThan(
      growing[0].output!.length
    );
    expect(steps.at(-1)).toMatchObject({ status: "done" });
    expect(events.at(-2)).toMatchObject({
      type: "item",
      item: { kind: "turn_end" },
    });
    expect(events.at(-1)).toEqual({ type: "state", state: "idle" });
  });

  it("holds a model wait with the measured prompt, and a retry", async () => {
    const { events, run } = harness();
    await runDemoScript({ phase: "retry", holdMs: 0 }, run, "t");
    expect(events).toContainEqual({ type: "prompt_tokens", tokens: 48_200 });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "model_retry", attempt: 2 })
    );
    expect(tools(events)).toEqual([]);
  });

  it("runs all three, one after the other, without a phase", async () => {
    const { events, run } = harness();
    await runDemoScript({ holdMs: 0 }, run, "t");
    expect(tools(events).at(-1)?.status).toBe("done");
    expect(events.some((e) => e.type === "model_retry")).toBe(true);
  });

  it("stops a running step when interrupted, and says so", async () => {
    const { events, run } = harness(
      (e) => e.type === "item" && e.item.kind === "tool"
    );
    await runDemoScript({ phase: "step", holdMs: 5000 }, run, "t");
    expect(tools(events).at(-1)).toMatchObject({ status: "stopped" });
    expect(events.at(-2)).toMatchObject({
      item: { kind: "turn_end", interrupted: true },
    });
  });
});
