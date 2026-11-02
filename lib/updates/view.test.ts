import { describe, expect, it } from "vitest";
import type { UpdateRun } from "./banner";
import { runSuperseded } from "./view";

const NEW = "a".repeat(40);
const RUNNING = "b".repeat(40);

const run = (phase: UpdateRun["phase"]): UpdateRun => ({
  id: "r1",
  phase,
  from: "c".repeat(40),
  to: NEW,
  fromVersion: "0.3.836",
  toVersion: "0.3.838",
  startedAt: 1,
});

// `descendants`: the builds that have NEW in their history.
const deps = (build: string, descendants: string[]) => ({
  buildId: () => build,
  git: async (args: string[]) => {
    expect(args.slice(0, 2)).toEqual(["merge-base", "--is-ancestor"]);
    if (!descendants.includes(args[3])) throw new Error("exit 1");
    return "";
  },
});

describe("runSuperseded", () => {
  it("clears a rolled-back or failed run once the running build has its commit", async () => {
    for (const phase of ["rolled_back", "failed"] as const)
      expect(await runSuperseded(run(phase), deps(RUNNING, [RUNNING]))).toBe(
        true
      );
    expect(await runSuperseded(run("rolled_back"), deps(NEW, []))).toBe(true);
  });

  it("keeps the notice while the running build lacks the commit", async () => {
    expect(await runSuperseded(run("rolled_back"), deps(RUNNING, []))).toBe(
      false
    );
  });

  it("leaves other runs and unknown builds alone", async () => {
    expect(await runSuperseded(run("done"), deps(RUNNING, [RUNNING]))).toBe(
      false
    );
    expect(await runSuperseded(null, deps(RUNNING, [RUNNING]))).toBe(false);
    expect(await runSuperseded(run("failed"), deps("v1.2.3", ["v1.2.3"]))).toBe(
      false
    );
  });
});
