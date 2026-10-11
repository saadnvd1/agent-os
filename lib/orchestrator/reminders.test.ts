import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { seedWorkspace } from "./testing";
import { ensureOrchestrator } from "./home";
import { runTool, TOOLS } from "./serve";
import {
  MAX_AGENT_REMINDERS,
  createSchedule,
  listSchedules,
} from "../schedules/store";
import { ORCHESTRATOR_PERMISSIONS } from "./tool-names";

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-remind-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

const soon = (mins: number) =>
  new Date(Date.now() + mins * 60_000).toISOString();

function ws() {
  const { workspace } = seedWorkspace();
  ensureOrchestrator(workspace.id);
  return workspace.id;
}

describe("remind_me", () => {
  it("creates a one-off orchestrator schedule in the caller's workspace", async () => {
    const w = ws();
    const reply = await runTool(w, "remind_me", {
      at: "in 2h",
      prompt: "Check PR #5",
      name: "PR 5",
    });
    expect(reply).toMatch(/^Reminder \w{8} set for .* \(in [12]h\)/);
    const [s] = listSchedules(w);
    expect(s).toMatchObject({
      name: "PR 5",
      kind: "orchestrator",
      workspace_id: w,
      prompt: "Check PR #5",
      timezone: "America/Chicago",
    });
    expect(s.run_at).toBeGreaterThan(Date.now() + 119 * 60_000);
    expect(s.created_by_session_id).toBe(ensureOrchestrator(w).id);
    expect(await runTool(w, "reminders")).toContain("PR 5");
  });

  it("refuses a past time, an unreadable one, and under ten minutes", async () => {
    const w = ws();
    await expect(
      runTool(w, "remind_me", { at: "2020-01-01T10:00", prompt: "x" })
    ).rejects.toThrow(/passed/);
    await expect(
      runTool(w, "remind_me", { at: "whenever", prompt: "x" })
    ).rejects.toThrow(/Can't read/);
    await expect(
      runTool(w, "remind_me", { at: "in 3m", prompt: "x" })
    ).rejects.toThrow(/10 minutes/);
    expect(listSchedules(w)).toHaveLength(0);
  });

  it("caps how many an agent keeps pending", async () => {
    const w = ws();
    for (let i = 0; i < MAX_AGENT_REMINDERS; i++)
      await runTool(w, "remind_me", { at: `in ${i + 1}d`, prompt: `r${i}` });
    await expect(
      runTool(w, "remind_me", { at: "in 25d", prompt: "one more" })
    ).rejects.toThrow(/at most/i);
  });

  it("doesn't count a session's own one-offs toward the cap", async () => {
    const w = ws();
    for (let i = 0; i < MAX_AGENT_REMINDERS; i++)
      createSchedule({
        workspaceId: w,
        name: `s${i}`,
        at: Date.now() + (i + 1) * 86_400_000,
        prompt: "x",
        kind: "orchestrator",
        createdBySessionId: "some-agent-session",
      });
    await expect(
      runTool(w, "remind_me", { at: "in 2h", prompt: "still fine" })
    ).resolves.toMatch(/set for/);
  });

  it("names two at the same minute apart", async () => {
    const w = ws();
    await runTool(w, "remind_me", { at: soon(60), prompt: "a" });
    await runTool(w, "remind_me", { at: soon(60), prompt: "b" });
    expect(new Set(listSchedules(w).map((s) => s.name)).size).toBe(2);
  });
});

describe("reminders and cancel_reminder are scoped to the workspace", () => {
  it("never list or cancel another workspace's", async () => {
    const a = ws();
    const b = ws();
    await runTool(a, "remind_me", {
      at: "in 2h",
      prompt: "a's",
      name: "A thing",
    });
    const [mine] = listSchedules(a);
    expect(await runTool(b, "reminders")).toBe("No reminders.");
    await expect(
      runTool(b, "cancel_reminder", { id: mine.id })
    ).rejects.toThrow(/No reminder/);
    expect(listSchedules(a)).toHaveLength(1);
    await expect(
      runTool(b, "cancel_reminder", { id: mine.id.slice(0, 8) })
    ).rejects.toThrow(/No reminder/);
  });

  it("cancels its own, and only those an orchestrator made", async () => {
    const w = ws();
    await runTool(w, "remind_me", {
      at: "in 2h",
      prompt: "mine",
      name: "Mine",
    });
    const saads = createSchedule({
      workspaceId: w,
      name: "Saad's",
      at: soon(120),
      prompt: "x",
      kind: "orchestrator",
    });
    await expect(
      runTool(w, "cancel_reminder", { id: saads.id })
    ).rejects.toThrow(/No reminder/);
    const own = listSchedules(w).find((s) => s.name === "Mine")!;
    expect(
      await runTool(w, "cancel_reminder", { id: own.id.slice(0, 8) })
    ).toMatch(/cancelled/);
    expect(listSchedules(w).map((s) => s.name)).toEqual(["Saad's"]);
    await expect(runTool(w, "cancel_reminder", { id: own.id })).rejects.toThrow(
      /No reminder/
    );
  });
});

describe("the tools", () => {
  it("are served and allowed, and none reads as an approval", () => {
    for (const t of ["remind_me", "reminders", "cancel_reminder"]) {
      expect(TOOLS).toContain(t);
      expect(
        ORCHESTRATOR_PERMISSIONS.allowedTools.some((n) => n.endsWith(t))
      ).toBe(true);
      expect(t).not.toMatch(/approve|answer|resume|pause/);
    }
  });
});
