import { NextRequest } from "next/server";
import { seedOrchestrator } from "../orchestrator/testing";
import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";

const { db, insertSessionRow } = await import("@/lib/db");
const { DEVICE_HEADER } = await import("@/lib/security/auth");
const { POST: hold } = await import("@/app/api/tasks/[id]/hold/route");
const { orchestratedStart } = await import("./held");
const { createTask } = await import("./index");

function running(over: Record<string, string> = {}) {
  seedOrchestrator("orch-1");
  const id = randomUUID();
  insertSessionRow(db, {
    id,
    name: "placed",
    tmux_name: `claude-${id}`,
    working_directory: "/tmp",
    view: "chat",
    task_status: "running",
    task_prompt: "x",
    ...over,
  });
  return id;
}
const call = (id: string, device: string | null) =>
  hold(
    new NextRequest(`http://x/api/tasks/${id}/hold`, {
      method: "POST",
      headers: device ? { [DEVICE_HEADER]: device } : {},
      body: JSON.stringify({
        orchestrated: orchestratedStart(randomUUID(), null),
      }),
    }),
    { params: Promise.resolve({ id }) }
  );
const heldBy = (id: string) =>
  (
    db
      .prepare(`SELECT held_by_device FROM session_rows WHERE id = ?`)
      .get(id) as {
      held_by_device: string | null;
    }
  ).held_by_device;

describe("holding a task that started unheld", () => {
  it("holds a running task for the paired device that started it", async () => {
    const id = running({ started_by_device: "dev-mac" });
    expect((await call(id, "dev-mac")).status).toBe(200);
    expect(heldBy(id)).toBe("dev-mac");
    expect((await call(id, "dev-mac")).status).toBe(200);
  });

  it("a task another plain task started is holdable: only an orchestrator owns", async () => {
    const parent = running();
    const id = running({ started_by: parent, started_by_device: "dev-mac" });
    expect((await call(id, "dev-mac")).status).toBe(200);
  });

  it("lets a paired device hold a task running before starters were recorded", async () => {
    const id = running({ started_by_device: "unrecorded" });
    expect((await call(id, "dev-mac")).status).toBe(200);
    expect(heldBy(id)).toBe("dev-mac");
  });

  it("refuses an unpaired caller and an unknown task, and starts nothing", async () => {
    const id = running({ started_by_device: "dev-mac" });
    expect((await call(id, null)).status).toBe(403);
    expect(heldBy(id)).toBeNull();
    expect((await call(randomUUID(), "dev-mac")).status).toBe(404);
  });

  it("refuses a device that didn't start the task", async () => {
    const id = running({ started_by_device: "dev-a" });
    expect((await call(id, "dev-b")).status).toBe(400);
    expect(heldBy(id)).toBeNull();
    const taken = running({
      held_by_device: "dev-a",
      started_by_device: "dev-a",
    });
    expect((await call(taken, "dev-b")).status).toBe(400);
    expect(heldBy(taken)).toBe("dev-a");
    const unrecorded = running();
    expect((await call(unrecorded, "dev-b")).status).toBe(400);
  });

  it("refuses a task this machine's own orchestrator or a person owns", async () => {
    const id = running({ started_by: "orch-1", started_by_device: "dev-mac" });
    expect((await call(id, "dev-mac")).status).toBe(400);
    expect(heldBy(id)).toBeNull();
  });

  it("does not hold a task that isn't running", async () => {
    const id = running({ task_status: "done", started_by_device: "dev-mac" });
    expect((await call(id, "dev-mac")).status).toBe(404);
    expect(heldBy(id)).toBeNull();
  });
});

describe("a keyed start retried with an orchestrator's description", () => {
  const retry = (id: string, device: string) =>
    createTask({
      startedVia: "person",
      id,
      projectId: "p",
      prompt: "x",
      held: { device, orchestrated: orchestratedStart(randomUUID(), null) },
    });

  it("holds only for the device that started it", async () => {
    const id = running({ started_by_device: "dev-mac" });
    await expect(retry(id, "dev-b")).rejects.toThrow("That id is taken");
    expect(heldBy(id)).toBeNull();
    await retry(id, "dev-mac");
    expect(heldBy(id)).toBe("dev-mac");
    await retry(id, "dev-mac");
  });

  it("refuses a task that isn't running or has a local owner", async () => {
    const done = running({ task_status: "done", started_by_device: "dev-mac" });
    await expect(retry(done, "dev-mac")).rejects.toThrow("That id is taken");
    const owned = running({
      started_by: "orch-1",
      started_by_device: "dev-mac",
    });
    await expect(retry(owned, "dev-mac")).rejects.toThrow("That id is taken");
  });
});
