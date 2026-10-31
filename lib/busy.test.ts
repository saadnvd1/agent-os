import * as os from "os";
import { describe, expect, it } from "vitest";
import { db } from "./db";
import { inFlight } from "./busy";
import { runStart } from "./simulator";
import { putCheck } from "./orchestrator/checks";
import { seedSession, seedWorkspace } from "./orchestrator/testing";

describe("inFlight", () => {
  it("counts running reviews and setups, not ones stuck for half an hour", () => {
    const { workspace, app } = seedWorkspace();
    const before = inFlight();
    const task = seedSession({ projectId: app.id, name: "t", task: true });
    const row = {
      workspaceId: workspace.id,
      sessionId: task,
      kind: "review" as const,
    };
    putCheck({ ...row, sha: "a".repeat(40), status: "running" });
    putCheck({ ...row, sha: "b".repeat(40), status: "pass" });
    db.prepare(`UPDATE sessions SET setup_status = 'running' WHERE id = ?`).run(
      task
    );
    // Neither an archived session's setup nor a CI settle check is in flight.
    const gone = seedSession({ projectId: app.id, name: "gone", task: true });
    db.prepare(
      `UPDATE sessions SET setup_status = 'running', archived_at = datetime('now') WHERE id = ?`
    ).run(gone);
    putCheck({ ...row, sha: "c".repeat(40), kind: "ci", status: "running" });
    expect(inFlight()).toEqual({
      reviews: before.reviews + 1,
      setups: before.setups + 1,
      simulatorStarts: before.simulatorStarts,
      merges: before.merges,
      landings: before.landings,
    });
    db.prepare(
      `UPDATE orchestrator_checks SET created_at = datetime('now', '-31 minutes') WHERE session_id = ?`
    ).run(task);
    db.prepare(
      `UPDATE sessions SET created_at = datetime('now', '-31 minutes') WHERE id = ?`
    ).run(task);
    expect(inFlight()).toEqual(before);
  });
});

describe("inFlight simulator starts", () => {
  it("counts a start while it runs, and not once it has ended", async () => {
    const before = inFlight().simulatorStarts;
    const done = runStart(
      `busy-test-${Date.now()}`,
      "sleep 1",
      os.tmpdir(),
      "udid",
      {}
    );
    expect(inFlight().simulatorStarts).toBe(before + 1);
    await done;
    expect(inFlight().simulatorStarts).toBe(before);
  });
});

describe("inFlight merges", () => {
  it("counts a sign-off and the tidying after a merge once per task", async () => {
    const { signingOff } = await import("./tasks/finish");
    const g = globalThis as unknown as {
      __agentosAfterMerge?: Map<string, Promise<void>>;
    };
    const before = inFlight().merges;
    signingOff.add("merge-a");
    g.__agentosAfterMerge!.set("merge-a", Promise.resolve());
    g.__agentosAfterMerge!.set("merge-b", Promise.resolve());
    try {
      expect(inFlight().merges).toBe(before + 2);
    } finally {
      signingOff.delete("merge-a");
      g.__agentosAfterMerge!.delete("merge-a");
      g.__agentosAfterMerge!.delete("merge-b");
    }
    expect(inFlight().merges).toBe(before);
  });
});
