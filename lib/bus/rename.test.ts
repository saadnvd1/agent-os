import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// Renaming tries tmux; no tmux here.
vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  hostExec: async () => ({ stdout: "", stderr: "" }),
}));

const { PATCH } = await import("@/app/api/sessions/[id]/route");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { createProject } = await import("@/lib/projects");
const { resolveTarget } = await import(".");

describe("renaming a session through the API", () => {
  it("keeps the old name reaching it", async () => {
    const project = createProject({
      name: `p-${randomUUID().slice(0, 6)}`,
      workingDirectory: "/tmp/p",
    });
    const tag = randomUUID().slice(0, 6);
    const id = seedSession({ projectId: project.id, name: `Session ${tag}` });

    const res = await PATCH(
      new NextRequest(`http://127.0.0.1:3011/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: `orchestrator-${tag}` }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);

    const { session, note } = resolveTarget(`Session ${tag}`);
    expect(session.id).toBe(id);
    expect(session.name).toBe(`orchestrator-${tag}`);
    expect(note).toBe(`"Session ${tag}" was renamed to "orchestrator-${tag}"`);
  });
});
