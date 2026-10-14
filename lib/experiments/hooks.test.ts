import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { setExperiment } from ".";
import { END_HOOKS, resetEndHooks, sessionEnded } from "./hooks";

beforeEach(() => {
  db.prepare(`DELETE FROM settings WHERE key LIKE 'experiments.%'`).run();
  resetEndHooks();
  delete END_HOOKS["learning-cards"];
});

describe("sessionEnded", () => {
  it("never calls the hook of an experiment that is off", async () => {
    const hook = vi.fn();
    END_HOOKS["learning-cards"] = hook;
    await sessionEnded("s1", "done");
    expect(hook).not.toHaveBeenCalled();
  });

  it("calls it once per session when the experiment is on", async () => {
    const hook = vi.fn();
    END_HOOKS["learning-cards"] = hook;
    setExperiment("learning-cards", true);
    await sessionEnded("s1", "done");
    await sessionEnded("s1", "merged");
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith("s1", "done");
  });

  it("swallows a hook that throws", async () => {
    END_HOOKS["learning-cards"] = () => {
      throw new Error("boom");
    };
    setExperiment("learning-cards", true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sessionEnded("s2", "done")).resolves.toBeUndefined();
  });

  it("hands on a recipe run settling after its session ended", async () => {
    const hook = vi.fn();
    END_HOOKS["learning-cards"] = hook;
    setExperiment("learning-cards", true);
    await sessionEnded("s2", "done");
    await sessionEnded("s2", "recipe-settled");
    await sessionEnded("s2", "recipe-settled");
    expect(hook.mock.calls).toEqual([
      ["s2", "done"],
      ["s2", "recipe-settled"],
    ]);
  });
});
