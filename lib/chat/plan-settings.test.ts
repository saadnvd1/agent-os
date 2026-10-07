import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { registry } from "./registry";
import { setChatPlan } from "./settings";

function session(role: string | null = null) {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, role) VALUES (?, 'chat', ?, '/tmp', ?)`
    )
    .run(id, `claude-${id}`, role);
  return id;
}
const plan = (id: string) =>
  (
    getDb().prepare(`SELECT chat_plan FROM sessions WHERE id = ?`).get(id) as {
      chat_plan: number;
    }
  ).chat_plan;

describe("setChatPlan", () => {
  it("remembers plan mode on the session", async () => {
    const id = session();
    expect(plan(id)).toBe(0);
    await setChatPlan(id, true);
    expect(plan(id)).toBe(1);
    await setChatPlan(id, false);
    expect(plan(id)).toBe(0);
  });

  it("leaves an orchestrator's fixed mode alone", async () => {
    const id = session("orchestrator");
    await setChatPlan(id, true);
    expect(plan(id)).toBe(0);
  });
});

describe("setChatPlan with a worker from an older build", () => {
  const live = (id: string, state: "idle" | "running") => {
    const commands: string[] = [];
    registry.live.set(id, {
      worker: {
        command: (c: { type: string }) => commands.push(c.type),
        detach: () => {},
      } as never,
      state,
      streaming: new Map(),
      activity: { tools: new Map(), tasks: new Set() },
      canPlan: false,
    });
    return commands;
  };

  it("refuses mid-turn rather than claim a mode the worker won't keep", async () => {
    const id = session();
    live(id, "running");
    await expect(setChatPlan(id, true)).rejects.toThrow("once this turn ends");
    expect(plan(id)).toBe(0);
  });

  it("retires an idle one, so the next message starts in plan mode", async () => {
    const id = session();
    const commands = live(id, "idle");
    await setChatPlan(id, true);
    expect(commands).toEqual(["close"]);
    expect(registry.live.has(id)).toBe(false);
    expect(plan(id)).toBe(1);
  });
});
