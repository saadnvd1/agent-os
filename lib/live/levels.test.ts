import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/db";
import { driveView, guestActions, levelOptions } from "./levels";
import { LEVELS } from "./types";
import type { Runtime } from "./runtime";

const task = {
  id: "s-levels",
  view: "chat",
  agent_type: "claude",
  role: null,
  task_prompt: "build it",
  worktree_path: "/tmp/wt-levels",
  working_directory: "/tmp/wt-levels",
  project_id: null,
  archived_at: null,
  task_status: "running",
} as unknown as Session;

const rt = (level: string, wheel: string | null = null) =>
  ({
    share: { id: "s", session_id: task.id, level },
    guests: new Map([
      [
        "g",
        { id: "g", name: "Ahmed", status: "admitted", online: true, at: 0 },
      ],
    ]),
    drive: {
      wheel: wheel ? { guestId: wheel, wheel: "w1" } : null,
      prompts: [],
      accepted: [],
      epoch: 0,
    },
  }) as unknown as Runtime;

describe("level options", () => {
  it("come from LEVELS; Drive is on only for a task's own worktree chat", () => {
    const o = levelOptions(task);
    expect(o.map((x) => x.value)).toEqual(["watch", "suggest", "drive"]);
    expect(o[0]).toMatchObject({ label: LEVELS.watch.label, enabled: true });
    expect(o[2]).toMatchObject({ enabled: true });
    expect(levelOptions(null)[2]).toMatchObject({
      enabled: false,
      reason: "Task sessions only",
    });
    expect(
      levelOptions({ ...task, task_prompt: null } as Session)[2]
    ).toMatchObject({ enabled: false, reason: "Task sessions only" });
    expect(
      levelOptions({ ...task, view: "terminal" } as Session)[2].enabled
    ).toBe(false);
  });

  it("gives a waiting guest Admit and Deny, an admitted one Kick", () => {
    const g = { id: "g", name: "A", online: true, at: 0 };
    expect(
      guestActions(rt("suggest"), { ...g, status: "pending" }, true).map(
        (a) => a.kind
      )
    ).toEqual(["admit", "deny"]);
    expect(
      guestActions(rt("suggest"), { ...g, status: "admitted" }, true).map(
        (a) => a.kind
      )
    ).toEqual(["kick"]);
  });

  it("on Drive offers Let in to drive only while nobody holds the wheel", () => {
    const g = {
      id: "p",
      name: "B",
      online: true,
      at: 0,
      status: "pending" as const,
    };
    expect(guestActions(rt("drive"), g, true).map((a) => a.label)).toEqual([
      "Let in",
      "Let in to drive",
      "Deny",
    ]);
    expect(guestActions(rt("drive", "g"), g, true).map((a) => a.kind)).toEqual([
      "admit",
      "deny",
    ]);
  });

  it("gives the wheel to an admitted guest and takes it back from its holder", () => {
    const g = {
      id: "g",
      name: "Ahmed",
      online: true,
      at: 0,
      status: "admitted" as const,
    };
    expect(guestActions(rt("drive"), g, true).map((a) => a.kind)).toEqual([
      "give_wheel",
      "kick",
    ]);
    expect(guestActions(rt("drive"), g, false).map((a) => a.kind)).toEqual([
      "kick",
    ]);
    expect(guestActions(rt("drive", "g"), g, true).map((a) => a.kind)).toEqual([
      "take_back",
      "kick",
    ]);
  });

  it("shows the driver and a Take back banner from the runtime", () => {
    expect(driveView(rt("drive"))).toEqual({ driver: null, banner: null });
    expect(driveView(rt("suggest", "g"))).toEqual({
      driver: null,
      banner: null,
    });
    expect(driveView(rt("drive", "g"))).toEqual({
      driver: { guestId: "g", name: "Ahmed", state: "idle" },
      banner: {
        text: "Ahmed is driving",
        action: { kind: "take_back", label: "Take back" },
      },
    });
  });
});
