import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  hostExec: async () => ({ stdout: "", stderr: "" }),
}));

const { PATCH } = await import("@/app/api/sessions/[id]/route");
const { db } = await import("@/lib/db");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { createProject } = await import("@/lib/projects");

describe("switching a chat to the terminal", () => {
  it("drops a restarted note left for the next chat worker", async () => {
    const project = createProject({
      name: `p-${randomUUID().slice(0, 6)}`,
      workingDirectory: "/tmp/p",
    });
    const id = seedSession({ projectId: project.id, name: "c", view: "chat" });
    db.prepare(`UPDATE sessions SET chat_restarted = 1 WHERE id = ?`).run(id);

    const res = await PATCH(
      new NextRequest(`http://127.0.0.1:3011/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ view: "terminal" }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    expect(
      db
        .prepare(`SELECT view, chat_restarted FROM sessions WHERE id = ?`)
        .get(id)
    ).toEqual({ view: "terminal", chat_restarted: 0 });
  });
});
