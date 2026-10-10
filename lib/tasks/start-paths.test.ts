import { randomUUID } from "crypto";
import path from "path";
import { execFile } from "child_process";
import http from "http";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Every way a task starts leaves its view to createTask's default (chat,
// lib/sessions/launch DEFAULT_START_VIEW) unless someone picked one; the
// default itself is start-view.test.ts's.

const calls: { view?: unknown }[] = [];
vi.mock("@/lib/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks")>()),
  createTask: async (o: { view?: unknown }) => {
    calls.push(o);
    return { id: randomUUID(), name: "t" };
  },
}));
vi.mock("@/lib/agents/spawn", () => ({
  findProject: () => ({ id: "p1" }),
  spawnSession: async () => ({ id: "s1", name: "s" }),
}));
vi.mock("@/lib/lumifyhub/task-cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lumifyhub/task-cards")>()),
  cardForTask: async () => ({
    project: { id: "p1" },
    card: { id: "c1", title: "Card" },
  }),
  promptFromCard: () => "do the card",
}));
vi.mock("@/lib/lumifyhub/connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lumifyhub/connection")>()),
  requireClient: () => ({
    getCard: async () => ({ id: "c1", title: "Card" }),
  }),
}));

const post = (body: object) =>
  new NextRequest("http://localhost/x", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => void (calls.length = 0));

describe("the view a task starts in, by how it was started", () => {
  it("New → task (POST /api/tasks): the default, or the pick", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    await POST(post({ projectId: "p1", prompt: "x" }));
    await POST(post({ projectId: "p1", prompt: "x", view: "terminal" }));
    await POST(post({ projectId: "p1", prompt: "x", view: "tmux" }));
    expect(calls.map((c) => c.view)).toEqual([
      undefined,
      "terminal",
      undefined,
    ]);
  });

  it("aos task: the default, or --terminal", async () => {
    const { POST } = await import("@/app/api/bus/spawn/route");
    await POST(post({ project: "p", prompt: "x", mode: "task" }));
    await POST(
      post({ project: "p", prompt: "x", mode: "task", view: "terminal" })
    );
    expect(calls.map((c) => c.view)).toEqual([undefined, "terminal"]);
    expect((await aos(["task", "app", "go"])).view).toBeUndefined();
    expect((await aos(["task", "app", "--terminal", "go"])).view).toBe(
      "terminal"
    );
  });

  it("a LumifyHub card's Run", async () => {
    const { POST } =
      await import("@/app/api/lumifyhub/cards/[cardId]/run/route");
    await POST(post({ projectId: "p1" }), {
      params: Promise.resolve({ cardId: randomUUID() }),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].view).toBeUndefined();
  });

  it("a stack's card", async () => {
    const { seedStack } = await import("../stacks/testing");
    const { startItem } = await import("../stacks/start");
    const { db, stackQueries } = await import("../db");
    const s = seedStack("/tmp", [{ key: "a", status: "planned" }]);
    await startItem(stackQueries.get(db, s.stackId)!, s.item("a"));
    expect(calls).toHaveLength(1);
    expect(calls[0].view).toBeUndefined();
  });

  it("a schedule's task", async () => {
    const { realDeps } = await import("../schedules/start");
    const { createSchedule } = await import("../schedules/store");
    const { createWorkspace, setProjectWorkspace } =
      await import("../workspaces");
    const { createProject } = await import("../projects");
    const ws = createWorkspace(`ws-${randomUUID().slice(0, 6)}`);
    const project = createProject({
      name: `p-${randomUUID().slice(0, 6)}`,
      workingDirectory: "/tmp",
    });
    setProjectWorkspace(project.id, ws.id);
    const schedule = createSchedule({
      workspaceId: ws.id,
      projectId: project.id,
      name: "Nightly",
      cron: "0 9 * * *",
      prompt: "Go",
      kind: "task",
    });
    await realDeps.start(schedule, () => {});
    expect(calls).toHaveLength(1);
    expect(calls[0].view).toBeUndefined();
  });
});

// What bin/aos sends for a task.
async function aos(args: string[]): Promise<{ view?: unknown }> {
  let body: { view?: unknown } = {};
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      body = JSON.parse(data);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ session: { name: "x" } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    await new Promise<void>((resolve, reject) =>
      execFile(
        process.execPath,
        [path.join(process.cwd(), "bin/aos"), ...args],
        { env: { ...process.env, AGENTOS_URL: `http://127.0.0.1:${port}` } },
        (err) => (err ? reject(err) : resolve())
      )
    );
    return body;
  } finally {
    server.close();
  }
}
