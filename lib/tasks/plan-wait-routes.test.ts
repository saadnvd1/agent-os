import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";

const { db } = await import("@/lib/db");
const { DEVICE_HEADER } = await import("@/lib/security/auth");
const { GET: planRoute } = await import("@/app/api/tasks/[id]/plan/route");
const { POST: approve } =
  await import("@/app/api/tasks/[id]/approve-plan/route");
const { planWaitRefusal } = await import("./held");

function task(waits: boolean) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, task_status, plan_phase, plan_waits_for_caller, started_by_device)
     VALUES (?, 't', ?, '/tmp', 'running', 'awaiting', ?, 'dev-a')`
  ).run(id, `claude-${id}`, waits ? 1 : null);
  return id;
}
const req = (device?: string) =>
  new NextRequest("http://localhost/x", {
    method: "POST",
    headers: device ? { [DEVICE_HEADER]: device } : {},
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("a plan that waits for the machine that placed it", () => {
  it("refuses every device but the one that started it", () => {
    const id = task(true);
    expect(planWaitRefusal(id, "dev-a")).toBeNull();
    expect(planWaitRefusal(id, "dev-b")).toMatch(/placed this plan decides/);
    expect(planWaitRefusal(id, null)).not.toBeNull();
  });

  it("leaves an ordinary task alone", () => {
    expect(planWaitRefusal(task(false), "dev-b")).toBeNull();
  });

  it("won't be approved or read by another device", async () => {
    const id = task(true);
    expect((await approve(req("dev-b"), ctx(id))).status).toBe(403);
    expect((await planRoute(req("dev-b"), ctx(id))).status).toBe(403);
  });
});
