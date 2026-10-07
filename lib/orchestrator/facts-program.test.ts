import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db";
import { getDb } from "@/lib/db";
import {
  applyProgramReport,
  reloadProgramStatus,
} from "@/lib/program-status/store";
import type { ProgramState } from "@/lib/program-status/parse";
import { statusOf } from "./facts";

const NAME = "claude-facts-program";
let screen: "running" | "waiting" | "idle" = "idle";

vi.mock("@/lib/status-detector", () => ({
  statusDetector: {
    sessionExists: () => true,
    getStatus: async () => screen,
    titleFor: () => "",
  },
}));

const session = {
  id: "facts-program",
  view: "terminal",
  tmux_name: NAME,
  updated_at: "2026-01-01 00:00:00",
  last_seen_at: "2026-01-01 00:00:00",
} as unknown as Session;

beforeEach(() => {
  getDb().prepare(`DELETE FROM program_status`).run();
  reloadProgramStatus();
});

const reported = (state: ProgramState) =>
  applyProgramReport(NAME, { state, id: "" });

describe("statusOf with a program's own report", () => {
  it("never lets a reported done or idle hide a busy screen", async () => {
    screen = "running";
    for (const state of ["done", "idle", "error"] as const) {
      reported(state);
      expect((await statusOf(session)).status).toBe("running");
    }
  });

  it("counts a reported working or blocked when the screen looks quiet", async () => {
    screen = "idle";
    reported("working");
    expect((await statusOf(session)).status).toBe("running");
    reported("blocked");
    expect(await statusOf(session)).toMatchObject({
      status: "waiting",
      needsInput: true,
    });
  });

  it("reads the screen otherwise", async () => {
    screen = "idle";
    reported("done");
    expect((await statusOf(session)).status).toBe("idle");
  });
});
