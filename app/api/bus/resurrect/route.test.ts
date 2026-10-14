import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const resurrect = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resurrect", () => ({ resurrectSession: resurrect }));

const { db } = await import("@/lib/db");
const { seedWorkspace } = await import("@/lib/orchestrator/testing");
const { POST } = await import("./route");

const call = (body: object) =>
  POST(
    new NextRequest("http://localhost/api/bus/resurrect", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

describe("POST /api/bus/resurrect (aos resurrect)", () => {
  it("runs only from inside a session", async () => {
    const res = await call({ session: "x" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/inside an AgentOS session/);
  });

  it("reaches only the caller's workspace, and lists what ended with no session", async () => {
    const mine = seedWorkspace("Bus mine");
    const other = seedWorkspace("Bus other");
    db.prepare(`UPDATE sessions SET task_status = 'dropped' WHERE id = ?`).run(
      mine.task
    );
    db.prepare(`UPDATE sessions SET task_status = 'dropped' WHERE id = ?`).run(
      other.task
    );
    const list = await (await call({ from: mine.chat })).json();
    expect(list.sessions.map((s: { id: string }) => s.id)).toEqual([mine.task]);

    const refused = await call({ from: mine.chat, session: other.task });
    expect(refused.status).toBe(409);
    expect(resurrect).not.toHaveBeenCalled();

    resurrect.mockResolvedValueOnce({ text: "back" });
    const ok = await call({ from: mine.chat, session: mine.task });
    expect((await ok.json()).summary).toBe("back");
    expect(resurrect).toHaveBeenCalledWith(mine.task);
  });
});
