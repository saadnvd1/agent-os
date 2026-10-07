import { describe, expect, it } from "vitest";
import {
  enterStage,
  finishSetup,
  getSetup,
  logStep,
  settingUp,
  startSetup,
} from "./setup-progress";

describe("setup progress", () => {
  it("moves stage by stage, and a failed step fails its stage", () => {
    const view = startSetup("s1", "feature/draft-s1");
    expect(settingUp("s1")).toBe(true);
    enterStage(view, "fetch");
    enterStage(view, "worktree");
    enterStage(view, "deps");
    logStep(view, {
      name: "Install",
      command: "npm ci",
      success: false,
      error: "ERESOLVE",
    });
    finishSetup("s1", view, "npm ci failed");
    const states = Object.fromEntries(view.stages.map((s) => [s.id, s.state]));
    expect(states).toEqual({
      fetch: "ok",
      worktree: "ok",
      env: "skipped",
      deps: "failed",
      script: "skipped",
    });
    expect(view.log).toEqual(["$ npm ci", "ERESOLVE"]);
    expect(settingUp("s1")).toBe(false);
    expect(getSetup("s1")?.status).toBe("failed");
  });

  it("keeps only the log's last lines", () => {
    const view = startSetup("s2", "b");
    logStep(view, {
      name: "x",
      command: "x",
      success: true,
      output: Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n"),
    });
    expect(view.log).toHaveLength(40);
    expect(view.log.at(-1)).toBe("line 99");
  });
});
