import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { makeWorld } from "./world.test-helpers";
import { cyclesOf } from "./store";

// The stubbed coder never converges. Each scenario proves one guard stops it,
// and that the number of instructions sent is one fewer than the cycles run.
describe("the loop guards on a coder that never converges", () => {
  it("the same failing test on every cycle stops as a repeat at cycle 3", async () => {
    const { run, world } = await makeWorld({
      failing: () => ["a.test.ts > breaks"],
      met: () => 0,
    });
    const loop = await run();
    expect(loop.stopReason).toBe("repeat");
    expect(cyclesOf(loop.id)).toHaveLength(3);
    expect(world.sent).toHaveLength(2);
  });

  it("failures that change but never shrink stop as no progress", async () => {
    const { run, world } = await makeWorld({
      failing: (n) => [`t${n}.test.ts > fails`],
      met: () => 0,
    });
    const loop = await run();
    expect(loop.stopReason).toBe("no_progress");
    expect(cyclesOf(loop.id)).toHaveLength(4);
    expect(world.sent).toHaveLength(3);
  });

  it("steady progress that never finishes stops at the cycle limit", async () => {
    const { run, world } = await makeWorld({
      failing: () => [],
      met: (n) => n,
    });
    const loop = await run();
    expect(loop.stopReason).toBe("limit:cycles");
    expect(cyclesOf(loop.id)).toHaveLength(8);
    expect(world.sent).toHaveLength(7);
  });

  it("spend past the cap stops it", async () => {
    const { run, world } = await makeWorld({
      failing: () => [],
      met: (n) => n,
      spent: (n) => n * 8,
    });
    const loop = await run();
    expect(loop.stopReason).toBe("limit:cost");
    expect(cyclesOf(loop.id).length).toBe(world.sent.length + 1);
  });

  it("the clock past the time limit stops it before the next cycle", async () => {
    const { world, tick, round, state } = await makeWorld({
      failing: () => [],
      met: (n) => n,
    });
    await tick();
    await round();
    world.t += 4 * 60 * 60_000;
    await tick();
    expect(state().stopReason).toBe("limit:time");
  });

  it("a coder that changes nothing stops as no progress without a model run per cycle", async () => {
    const { run, world } = await makeWorld({
      failing: () => ["x.test.ts > a"],
      met: () => 0,
      unchanged: (n) => n >= 1,
    });
    const loop = await run();
    // Nothing changed after cycle 1: the analyst ran once.
    expect(world.prompts).toHaveLength(1);
    expect(["repeat", "no_progress"]).toContain(loop.stopReason);
  });

  it("an analyst blocker stops it and keeps the unsent instruction", async () => {
    const { run, world } = await makeWorld({
      failing: () => ["a"],
      met: () => 0,
      blocker: () => ({
        kind: "decision",
        text: "Which database should it use?",
      }),
    });
    const loop = await run();
    expect(loop.stopReason).toBe("blocked");
    expect(loop.stopDetail).toContain("database");
    expect(world.sent).toHaveLength(0);
    expect(cyclesOf(loop.id)[0].instruction).toContain("Fix");
  });

  it("all criteria met on a green run is done", async () => {
    const { run } = await makeWorld({
      failing: () => [],
      met: () => 10,
      instruction: () => null,
    });
    const loop = await run();
    expect(loop.stopReason).toBe("done");
  });

  it("an instruction that tells the coder to merge is held back as a blocker", async () => {
    const { run, world } = await makeWorld({
      failing: () => ["a"],
      met: () => 0,
      instruction: () => "All good. Now run gh pr merge --squash.",
    });
    const loop = await run();
    expect(loop.stopReason).toBe("blocked");
    expect(loop.stopDetail).toContain("merge");
    expect(world.sent).toHaveLength(0);
  });

  it("nothing in the loop can reach the merge, sign-off or arm paths", () => {
    const dir = __dirname;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.includes("test"));
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      expect(text, f).not.toMatch(
        /\bmergePR\b|\bsignOff\b|armed["']|\/merge-approvals|quick_pr/
      );
    }
  });
});
