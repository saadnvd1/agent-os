import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `aos spawn` / `aos task --agent`: which agent and model reach the launcher.

interface Opts {
  agent?: string;
  agentType?: string;
  model?: unknown;
  agentRole?: string;
}
const tasks: Opts[] = [];
const chats: Opts[] = [];
vi.mock("@/lib/tasks", () => ({
  createTask: async (o: Opts) => {
    tasks.push(o);
    return { id: "t1", name: "t" };
  },
}));
vi.mock("@/lib/tasks/queue", () => ({
  stampPriority: () => undefined,
  startOrQueue: async (_: unknown, start: () => Promise<unknown>) => ({
    started: await start(),
  }),
}));
vi.mock("@/lib/agents/spawn", async () => {
  const { getProject } = await import("@/lib/projects");
  return {
    findProject: (id: string) => getProject(id),
    spawnSession: async () => ({ id: "s1", name: "s" }),
  };
});
vi.mock("@/lib/sessions/launch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sessions/launch")>()),
  launchSession: async (o: Opts) => {
    chats.push(o);
    return { session: { id: "c1", name: "c" } };
  },
}));

const { createProject } = await import("@/lib/projects");
const { POST } = await import("@/app/api/bus/spawn/route");

const web = createProject({
  name: `web-${randomUUID().slice(0, 6)}`,
  workingDirectory: "/tmp/web",
});
const post = (body: object) =>
  POST(
    new NextRequest("http://127.0.0.1:3011/api/bus/spawn", {
      method: "POST",
      body: JSON.stringify({ project: web.id, prompt: "p", ...body }),
    })
  );

beforeEach(() => {
  tasks.length = 0;
  chats.length = 0;
});

describe("/api/bus/spawn agent", () => {
  it("starts a chat on the named agent with its model", async () => {
    const res = await post({ agent: "codex", model: "gpt-5" });
    expect(res.status).toBe(201);
    expect(chats[0]).toMatchObject({ agentType: "codex", model: "gpt-5" });
  });

  it("defaults to claude", async () => {
    await post({});
    expect(chats[0].agentType).toBe("claude");
  });

  it("hands a task the agent, but leaves claude as the default", async () => {
    await post({ mode: "task", agent: "codex", model: "gpt-5" });
    await post({ mode: "task", agent: "claude" });
    expect(tasks[0]).toMatchObject({ agent: "codex", model: "gpt-5" });
    expect(tasks[1].agent).toBeUndefined();
  });

  it("refuses an unknown agent", async () => {
    const res = await post({ agent: "nope" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Unknown agent/);
    expect(chats).toHaveLength(0);
  });

  it("refuses an agent with a role or a terminal view", async () => {
    const withRole = await post({ agent: "codex", agentRole: "analyst" });
    expect((await withRole.json()).error).toMatch(/--role/);
    const terminal = await post({ agent: "codex", view: "terminal" });
    expect((await terminal.json()).error).toMatch(/--terminal/);
    expect(chats).toHaveLength(0);
  });
});
