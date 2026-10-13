import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

const stopped = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/sessions/stop", () => ({
  stopSession: async (t: { id: string }) => {
    stopped.push(t.id);
    return "stopped";
  },
}));
const done = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/done", async (orig) => ({
  ...(await orig<typeof import("@/lib/done")>()),
  doneSession: async (id: string, o: { noMerge?: boolean }) => {
    expect(o.noMerge).toBe(true);
    done.push(id);
    return { merged: false };
  },
}));
const sent = vi.hoisted(() => [] as { text: string; origin: unknown }[]);
vi.mock("@/lib/chat/runner", async (orig) => ({
  ...(await orig<typeof import("@/lib/chat/runner")>()),
  sendChatConfirmed: async (
    _id: string,
    m: { text: string; origin: unknown }
  ) => {
    sent.push(m);
    return "sent";
  },
}));

const { db } = await import("@/lib/db");
const { DEVICE_HEADER } = await import("@/lib/security/auth");
const { POST: stop } = await import("@/app/api/tasks/[id]/stop/route");
const { POST: done_ } = await import("@/app/api/tasks/[id]/done/route");
const { POST: message } = await import("@/app/api/tasks/[id]/message/route");
const { POST: merge } = await import("@/app/api/tasks/[id]/merge/route");
const { POST: arm } = await import("@/app/api/tasks/[id]/arm/route");
const { GET: chatFacts } =
  await import("@/app/api/tasks/[id]/chat-facts/route");

function held(view: "chat" | "terminal" = "chat") {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, view, task_status,
       held_by_device, held_from, task_prompt)
     VALUES (?, 'held-one', ?, '/tmp', ?, 'running', 'dev-mac', 'the Mac', 'x')`
  ).run(id, `claude-${id}`, view);
  return id;
}
const call = (
  route: (r: NextRequest, c: { params: Promise<{ id: string }> }) => unknown,
  id: string,
  device: string | null,
  body: object = {}
) =>
  route(
    new NextRequest(`http://x/api/tasks/${id}/x`, {
      method: "POST",
      headers: device ? { [DEVICE_HEADER]: device } : {},
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  ) as Promise<Response>;

describe("a held task's routes", () => {
  it("answer only the device that moved it here", async () => {
    const id = held();
    for (const r of [stop, done_, message]) {
      expect((await call(r, id, "dev-other", { line: "hi" })).status).toBe(403);
      expect((await call(r, id, null, { line: "hi" })).status).toBe(403);
    }
    expect(stopped).toEqual([]);
    expect(done).toEqual([]);
    expect(sent).toEqual([]);
    expect((await call(stop, id, "dev-mac")).status).toBe(200);
    expect((await call(done_, id, "dev-mac")).status).toBe(200);
    expect(stopped).toEqual([id]);
    expect(done).toEqual([id]);
  });

  it("are not there for an ordinary task", async () => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, task_status)
       VALUES (?, 'plain', ?, '/tmp', 'running')`
    ).run(id, `claude-${id}`);
    expect((await call(stop, id, "dev-mac")).status).toBe(404);
  });

  it("deliver a message as the orchestrator's, never the user's", async () => {
    const id = held();
    const r = await call(message, id, "dev-mac", {
      id: "bus-1",
      line: "use the other index",
      from: "orchestrator",
    });
    expect(r.status).toBe(200);
    expect(sent[0].text).toBe("use the other index");
    expect(sent[0].origin).toMatchObject({ kind: "peer" });
  });

  it("refuse merging and arming to anyone but the holder, and to the holder here", async () => {
    const id = held();
    expect((await call(merge, id, "dev-other")).status).toBe(403);
    expect((await call(arm, id, "dev-other")).status).toBe(403);
    expect((await call(merge, id, null)).status).toBe(403);
  });

  it("say what the chat says about being blocked, to the holder only", async () => {
    const id = held();
    const get = (device: string | null) =>
      chatFacts(
        new NextRequest(`http://x/api/tasks/${id}/chat-facts`, {
          headers: device ? { [DEVICE_HEADER]: device } : {},
        }),
        { params: Promise.resolve({ id }) }
      ) as Promise<Response>;
    expect((await get("dev-other")).status).toBe(403);
    expect((await get(null)).status).toBe(403);
    const ok = await get("dev-mac");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ blocked: null, turn: null });
  });
});
