import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
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
