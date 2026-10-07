import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import type { WorkerCommand } from "./worker/protocol";
import type { ChatItem } from "./events";

const { registry, emit } = await import("./registry");
const { listItems, saveItem } = await import("./store");
const { carryOutPlan } = await import("./runner");
const { seedSession } = await import("../orchestrator/testing");
const { createProject } = await import("../projects");

// A chat in plan mode with a proposed plan, and a worker that records each
// send once by id, as the real one does.
function planningChat({
  takesSends = true,
  dedupes = true,
  state = "idle" as "idle" | "running",
} = {}) {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  const id = seedSession({ projectId: project.id, name: "chat", view: "chat" });
  getDb().prepare(`UPDATE sessions SET chat_plan = 1 WHERE id = ?`).run(id);
  const plan: ChatItem = {
    id: "plan-t1",
    kind: "plan",
    plan: "# Plan",
    createdAt: 1,
  };
  saveItem(id, plan);
  const commands: WorkerCommand[] = [];
  registry.live.set(id, {
    worker: {
      command: (cmd: WorkerCommand) => {
        commands.push(cmd);
        if (cmd.type !== "send" || !takesSends) return;
        if (dedupes && listItems(id).some((i) => i.id === cmd.id)) return;
        const item: ChatItem = {
          id: cmd.id,
          kind: "user",
          text: cmd.text,
          createdAt: Date.now(),
        };
        saveItem(id, item);
        setTimeout(() => emit(id, { type: "item", item }), 1);
      },
    } as never,
    state,
    streaming: new Map(),
    activity: { tools: new Map(), tasks: new Set() },
    canPlan: true,
  });
  const planMode = () =>
    (
      getDb()
        .prepare(`SELECT chat_plan FROM sessions WHERE id = ?`)
        .get(id) as { chat_plan: number }
    ).chat_plan;
  return { id, commands, planMode };
}

describe("carryOutPlan", () => {
  it("leaves plan mode before asking for the plan, then marks the card", async () => {
    const { id, commands, planMode } = planningChat();
    await carryOutPlan(id, "plan-t1");
    expect(planMode()).toBe(0);
    const types = commands.map((c) => c.type);
    expect(types.indexOf("set_plan")).toBeLessThan(types.indexOf("send"));
    expect(commands.find((c) => c.type === "set_plan")).toMatchObject({
      plan: false,
    });
    const plan = listItems(id).find((i) => i.id === "plan-t1");
    expect(plan).toMatchObject({ carried: true });
  });

  it("asks once however often it's tapped", async () => {
    const { id } = planningChat();
    await Promise.all([
      carryOutPlan(id, "plan-t1"),
      carryOutPlan(id, "plan-t1"),
    ]);
    await carryOutPlan(id, "plan-t1");
    expect(
      listItems(id)
        .filter((i) => i.kind === "user")
        .map((i) => i.id)
    ).toEqual(["user-carry-plan-t1"]);
  });

  it("leaves the card to try again when the worker never takes it", async () => {
    const { id, commands } = planningChat({ takesSends: false });
    await expect(carryOutPlan(id, "plan-t1", 30)).rejects.toThrow(
      "didn't take it"
    );
    expect(commands.some((c) => c.type === "send")).toBe(true);
    const plan = listItems(id).find((i) => i.id === "plan-t1");
    expect(plan).not.toHaveProperty("carried");
  });

  it("doesn't ask again when the message is already in (a retry after a restart)", async () => {
    // A fresh worker has no memory of what it was sent before.
    const { id, commands } = planningChat({ dedupes: false });
    saveItem(id, {
      id: "user-carry-plan-t1",
      kind: "user",
      text: "Carry out the plan.",
      createdAt: 2,
    });
    await carryOutPlan(id, "plan-t1");
    expect(commands.some((c) => c.type === "send")).toBe(false);
    expect(listItems(id).find((i) => i.id === "plan-t1")).toMatchObject({
      carried: true,
    });
  });

  it("waits for the planning turn to end before leaving plan mode", async () => {
    const { id, commands, planMode } = planningChat({ state: "running" });
    await expect(carryOutPlan(id, "plan-t1")).rejects.toThrow(
      "once this turn ends"
    );
    expect(commands).toEqual([]);
    expect(planMode()).toBe(1);
  });

  it("refuses anything that isn't a plan", async () => {
    const { id } = planningChat();
    await expect(carryOutPlan(id, "nope")).rejects.toThrow("plan is gone");
  });
});
