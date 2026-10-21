import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const route = await import("./route");
const { saveItem } = await import("@/lib/chat/store");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { createProject } = await import("@/lib/projects");

const secret = ["gh", "p_", "d".repeat(36)].join("");
const post = (b: unknown) =>
  new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function session() {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  const id = seedSession({
    projectId: project.id,
    name: "Copy me",
    view: "chat",
  });
  let t = 1;
  const add = (i: Record<string, unknown>) =>
    saveItem(id, { id: `c${t}`, createdAt: t++, ...i } as never);
  add({ kind: "user", text: "first" });
  add({ kind: "assistant", text: "one" });
  add({ kind: "user", text: "second" });
  add({ kind: "assistant", text: `two ${secret}` });
  return id;
}

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/sessions/:id/export/turn", () => {
  it("returns the turn and its response, secrets masked", async () => {
    const id = session();
    const res = await route.POST(post({ startId: "c3" }), params(id));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.response).toContain("two [secret]");
    expect(j.full).toContain("two [secret]");
    expect(j.full).not.toContain("one");
    expect(JSON.stringify(j)).not.toContain(secret);
  });

  it("404s an unknown turn and 400s a missing id", async () => {
    const id = session();
    expect((await route.POST(post({ startId: "zz" }), params(id))).status).toBe(
      404
    );
    expect((await route.POST(post({}), params(id))).status).toBe(400);
  });

  it("refuses in the demo", async () => {
    vi.stubEnv("AGENTOS_DEMO", "1");
    const res = await route.POST(post({ startId: "c1" }), params(session()));
    expect(res.status).toBe(403);
  });
});
