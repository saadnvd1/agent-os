import { describe, expect, it } from "vitest";
import { setupNote, setupOutcome, taskSetupOf } from "./setup";
import type { SetupResult } from "../env-setup";

const result = (over: Partial<SetupResult>): SetupResult => ({
  success: true,
  steps: [],
  envFilesCopied: [],
  durationMs: 1200,
  ...over,
});

describe("task setup", () => {
  it("records an ok setup and tells the agent nothing", () => {
    const setup = setupOutcome(result({}));
    expect(setup).toEqual({ status: "ok", ms: 1200, error: null });
    expect(setupNote(setup)).toBe("");
  });

  it("names the step that failed and tells the agent in its prompt", () => {
    const setup = setupOutcome(
      result({
        success: false,
        steps: [
          {
            name: "i",
            command: "npm ci --include=dev",
            success: false,
            error: "E1",
          },
          {
            name: "i",
            command: "npm install --include=dev",
            success: false,
            error: "ENOTFOUND registry",
          },
        ],
      })
    );
    expect(setup.status).toBe("failed");
    expect(setup.error).toBe(
      "`npm install --include=dev` failed: ENOTFOUND registry"
    );
    expect(setupNote(setup)).toContain(
      '<untrusted source="worktree setup">`npm install --include=dev` failed: ENOTFOUND registry</untrusted>'
    );
  });

  it("redacts secrets an install printed", () => {
    const setup = setupOutcome(
      result({
        success: false,
        steps: [
          {
            name: "i",
            command: "npm ci",
            success: false,
            error: "GET https://me:hunter2secret@registry.example.com/x 401",
          },
        ],
      })
    );
    expect(setup.error).not.toContain("hunter2secret");
  });

  it("treats a setup that threw as failed", () => {
    expect(setupOutcome(new Error("boom"))).toEqual({
      status: "failed",
      ms: null,
      error: "boom",
    });
  });

  it("reads only known statuses off the row", () => {
    expect(taskSetupOf({ setup_status: null })).toBeNull();
    expect(taskSetupOf({ setup_status: "running" })).toEqual({
      status: "running",
      ms: null,
      error: null,
    });
  });
});
