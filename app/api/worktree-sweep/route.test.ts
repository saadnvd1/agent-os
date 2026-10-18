import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

const { GET, PUT } = await import("./route");
const { createProject } = await import("@/lib/projects");

const put = (body: unknown, trust: string | null = "loopback") =>
  PUT(
    new NextRequest("http://localhost/api/worktree-sweep", {
      method: "PUT",
      headers: trust ? { "x-agentos-trust": trust } : {},
      body: JSON.stringify(body),
    })
  );

describe("/api/worktree-sweep", () => {
  it("round-trips the global number and a project's own", async () => {
    const p = createProject({
      name: `app-${randomUUID().slice(0, 8)}`,
      workingDirectory: "/tmp/app",
    });
    expect((await (await GET()).json()).days).toBeNull();
    expect((await (await put({ days: 3 })).json()).days).toBe(3);
    const state = await (await put({ days: 0, projectId: p.id })).json();
    expect(state.overrides).toEqual([
      { projectId: p.id, name: p.name, days: 0 },
    ]);
    const cleared = await (await put({ days: null, projectId: p.id })).json();
    expect(cleared.overrides).toEqual([]);
    expect((await (await put({ days: null })).json()).days).toBeNull();
  });

  it("turns the full clean-up on and off, off by default", async () => {
    expect((await (await GET()).json()).armed).toBe(false);
    expect((await (await put({ armed: true })).json()).armed).toBe(true);
    expect((await (await GET()).json()).armed).toBe(true);
    expect((await (await put({ armed: false })).json()).armed).toBe(false);
    expect((await put({ armed: "yes" })).status).toBe(400);
  });

  it("turns the full clean-up on only from this machine or the tailnet, off from anywhere", async () => {
    expect((await put({ armed: true }, null)).status).toBe(403);
    expect((await put({ armed: true }, "device")).status).toBe(403);
    expect((await (await GET()).json()).armed).toBe(false);
    expect((await put({ armed: true }, "tailnet")).status).toBe(200);
    expect((await put({ armed: false }, null)).status).toBe(200);
    expect((await (await GET()).json()).armed).toBe(false);
  });

  it("lets a session turn it on only as an orchestrator with full access", async () => {
    const { createWorkspace, updateWorkspace } =
      await import("@/lib/workspaces");
    const { ensureOrchestrator } = await import("@/lib/orchestrator/home");
    const { db } = await import("@/lib/db");
    const w = createWorkspace(`sw-${randomUUID().slice(0, 6)}`);
    const o = ensureOrchestrator(w.id);
    expect((await put({ armed: true, session: o.id })).status).toBe(200);
    await put({ armed: false });
    // A task agent's session, in the same workspace.
    db.prepare(`UPDATE sessions SET role = NULL WHERE id = ?`).run(o.id);
    expect((await put({ armed: true, session: o.id })).status).toBe(403);
    db.prepare(`UPDATE sessions SET role = 'orchestrator' WHERE id = ?`).run(
      o.id
    );
    updateWorkspace(w.id, { orchFullAccess: false });
    expect((await put({ armed: true, session: o.id })).status).toBe(403);
    expect((await put({ armed: true, session: "nobody" })).status).toBe(403);
    expect((await (await GET()).json()).armed).toBe(false);
  });

  it("refuses a number that isn't a whole 0-365", async () => {
    for (const days of [-1, 1.5, 400, "7", undefined]) {
      const res = await put({ days });
      expect(res.status).toBe(400);
    }
    expect((await put("nope")).status).toBe(400);
  });
});
