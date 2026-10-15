import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const approvedNow = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/models/plan-step", async (orig) => ({
  ...(await orig<typeof import("@/lib/models/plan-step")>()),
  approvePlanNow: async (id: string) => {
    approvedNow.push(id);
    return { ref: "x" };
  },
}));
import { randomUUID } from "crypto";

const { db } = await import("@/lib/db");
const { DEVICE_HEADER } = await import("@/lib/security/auth");
const { GET: planRoute } = await import("@/app/api/tasks/[id]/plan/route");
const { POST: approve } =
  await import("@/app/api/tasks/[id]/approve-plan/route");
const { planWaitRefusal } = await import("./held");
const { createHost } = await import("@/lib/hosts");

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

describe("the machine that placed the plan", () => {
  it("is not refused on its own mirror, from its UI or any device", async () => {
    const host = createHost("peer", "u@peer");
    const id = task(true);
    db.prepare(
      `UPDATE sessions SET host_id = ?, started_by_device = NULL WHERE id = ?`
    ).run(host.id, id);
    expect(planWaitRefusal(id, null)).toBeNull();
    expect(planWaitRefusal(id, "dev-b")).toBeNull();
    expect((await approve(req(), ctx(id))).status).not.toBe(403);
  });

  it("sweeping no-approvals on leaves a plan placed here for the placing machine", async () => {
    const theirs = task(true);
    const { switchNoApprovals } = await import("@/lib/approvals/enable");
    await switchNoApprovals(true);
    try {
      expect(approvedNow).not.toContain(theirs);
    } finally {
      await switchNoApprovals(false);
    }
  });
});
