import http from "http";
import path from "path";
import { execFile } from "child_process";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const created: { kind: string; name?: string; prompt: string }[] = [];
vi.mock("@/lib/tasks", () => ({
  createTask: async (o: { name?: string; prompt: string }) => {
    created.push({ kind: "task", name: o.name, prompt: o.prompt });
    return { id: "t1", name: o.name ?? "generated" };
  },
}));
// Queued only when it waits on another task; the queue has its own tests.
vi.mock("@/lib/tasks/queue", () => ({
  queueIfNeeded: (o: { after?: string; name?: string }) =>
    o.after
      ? { id: "q1", name: o.name ?? "x", position: 1, after: o.after }
      : null,
}));
vi.mock("@/lib/agents/spawn", () => ({
  findProject: () => ({ id: "p1" }),
  spawnSession: async (o: { name?: string; prompt: string }) => {
    created.push({ kind: "session", name: o.name, prompt: o.prompt });
    return { id: "s1", name: o.name ?? "generated" };
  },
}));

const { POST } = await import("@/app/api/bus/spawn/route");

// Runs bin/aos against a server that records what it was sent.
async function aos(
  args: string[],
  reply: unknown = { session: { name: "x" } }
): Promise<{ body: unknown; out: string }> {
  let body: unknown;
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      body = JSON.parse(data);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    const out = await new Promise<string>((resolve, reject) =>
      execFile(
        process.execPath,
        [path.join(process.cwd(), "bin/aos"), ...args],
        { env: { ...process.env, AGENTOS_URL: `http://127.0.0.1:${port}` } },
        (err, stdout) => (err ? reject(err) : resolve(stdout))
      )
    );
    return { body, out };
  } finally {
    server.close();
  }
}

describe("naming a spawned session or task", () => {
  it("aos sends --name, and only before the prompt", async () => {
    const { body } = await aos([
      "task",
      "agent-os",
      "--name",
      "Nightly audit",
      "check",
      "the --name flag",
    ]);
    expect(body).toEqual({
      project: "agent-os",
      prompt: "check the --name flag",
      mode: "task",
      name: "Nightly audit",
    });
  });

  it("aos sends no name when none is given", async () => {
    const { body } = await aos(["spawn", "agent-os", "fix", "it"]);
    expect(body).toEqual({
      project: "agent-os",
      prompt: "fix it",
      mode: "session",
    });
  });

  it("aos task --after queues it and says what it waits on", async () => {
    const { body, out } = await aos(
      ["task", "agent-os", "--after", "add-auth", "follow", "up"],
      { queued: { name: "follow up", position: 2, after: "add-auth" } }
    );
    expect(body).toEqual({
      project: "agent-os",
      prompt: "follow up",
      mode: "task",
      after: "add-auth",
    });
    expect(out).toMatch(/queued task "follow up" \(after add-auth\)/);
  });

  it("the route queues a task with after, and refuses after for a session", async () => {
    const post = (body: object) =>
      POST(
        new NextRequest("http://127.0.0.1:3011/api/bus/spawn", {
          method: "POST",
          body: JSON.stringify({ project: "agent-os", prompt: "p", ...body }),
        })
      );
    const queued = await post({ mode: "task", after: "any" });
    expect(queued.status).toBe(202);
    expect((await queued.json()).queued).toMatchObject({ after: "any" });
    expect((await post({ mode: "session", after: "any" })).status).toBe(400);
  });

  it("the route passes the name through to tasks and sessions", async () => {
    created.length = 0;
    for (const mode of ["task", "session"]) {
      const res = await POST(
        new NextRequest("http://127.0.0.1:3011/api/bus/spawn", {
          method: "POST",
          body: JSON.stringify({
            project: "agent-os",
            prompt: "do it",
            mode,
            name: "Nightly audit",
          }),
        })
      );
      expect(res.status).toBe(201);
    }
    expect(created).toEqual([
      { kind: "task", name: "Nightly audit", prompt: "do it" },
      { kind: "session", name: "Nightly audit", prompt: "do it" },
    ]);
  });
});
