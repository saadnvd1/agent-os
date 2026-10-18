import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tasks/gh", async (orig) => ({
  ...(await orig<object>()),
  run: vi.fn().mockRejectedValue(new Error("no gh")),
}));

import { db, updateSessionRow } from "../db";
import {
  captureMergedTask,
  resetSessionLogState,
  setLogFolder,
} from "../session-logs";
import { runTool } from "./serve";
import { seedWorkspace } from "./testing";
import { tempDir } from "@/lib/test-temp";

function logged(name: string, merged: string, pr: number) {
  const w = seedWorkspace();
  updateSessionRow(db, w.task, {
    name,
    task_prompt: `Brief for ${name}`,
    task_status: "merged",
    pr_status: "merged",
    pr_number: pr,
    merged_at: merged,
  });
  setLogFolder(w.api.id, tempDir("orch-logs-"));
  return w;
}

beforeEach(() => {
  resetSessionLogState();
  db.exec(`DELETE FROM session_logs`);
});

describe("logs tool", () => {
  it("lists the latest headers, newest merge first, from this workspace only", async () => {
    const a = logged("older task", "2026-10-01 10:00:00", 1);
    await captureMergedTask(a.task);
    const b = logged("newer task", "2026-10-05 10:00:00", 2);
    await captureMergedTask(b.task);
    // Moved into the same workspace, so one workspace holds both.
    db.prepare(
      `UPDATE session_logs SET workspace_id = ? WHERE session_id = ?`
    ).run(a.workspace.id, b.task);
    const out = await runTool(a.workspace.id, "logs", {});
    expect(out).toContain("<untrusted");
    expect(out.indexOf("newer task")).toBeLessThan(out.indexOf("older task"));
    expect(out).toContain("#2");
    expect(await runTool(a.workspace.id, "logs", { n: 1 })).not.toContain(
      "older task"
    );
    expect(await runTool(b.workspace.id, "logs", {})).toContain(
      "No session logs"
    );
  });

  it("returns one log in full by name, id prefix or PR, and refuses another workspace's", async () => {
    const a = logged("fix the thing", "2026-10-01 10:00:00", 31);
    await captureMergedTask(a.task);
    const other = seedWorkspace();
    for (const ref of ["fix the thing", a.task.slice(0, 8), "#31"]) {
      const out = await runTool(a.workspace.id, "logs", { task: ref });
      expect(out).toContain("Brief for fix the thing");
      expect(out).toContain("## Timeline");
    }
    await expect(
      runTool(other.workspace.id, "logs", { task: "fix the thing" })
    ).rejects.toThrow(/No log for/);
    await expect(
      runTool(a.workspace.id, "logs", { project: a.api.name, task: "nope" })
    ).rejects.toThrow(/No log for/);
  });
});
