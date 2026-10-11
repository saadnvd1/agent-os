import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// What deleting a session ends: tmux sessions by name, and the chat worker.
const ended = vi.hoisted(() => [] as { host: unknown; name: unknown }[]);
const stopped = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/tmux/end", () => ({
  endTmuxSession: async (host: unknown, name: unknown) => {
    ended.push({ host, name });
  },
}));
vi.mock("@/lib/chat/runner", async (original) => ({
  ...(await original<typeof import("@/lib/chat/runner")>()),
  stopChat: (id: string) => stopped.push(id),
}));
vi.mock("@/lib/chat/worker/client", async (original) => ({
  ...(await original<typeof import("@/lib/chat/worker/client")>()),
  waitForExit: async () => {},
}));

const { DELETE } = await import("@/app/api/sessions/[id]/route");
const { db } = await import("@/lib/db");

const remove = (id: string) =>
  DELETE(new NextRequest("http://x", { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
const exists = (id: string) =>
  !!db.prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(id);
function add(fields: { tmux_name: string; host_id?: string }) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, host_id)
     VALUES (?, 's', ?, '/tmp', ?)`
  ).run(id, fields.tmux_name, fields.host_id ?? "local");
  return id;
}

beforeEach(() => {
  ended.length = 0;
  stopped.length = 0;
});

describe("DELETE /api/sessions/[id]", () => {
  it("ends the session's own tmux session, not just its row", async () => {
    const id = add({ tmux_name: "claude-keepme" });
    const res = await remove(id);
    expect(res.status).toBe(200);
    expect(exists(id)).toBe(false);
    expect(ended).toEqual([{ host: "local", name: "claude-keepme" }]);
    expect(stopped).toEqual([id]);
  });

  it("ends it on the machine the session runs on", async () => {
    const id = add({ tmux_name: "claude-far", host_id: "host-1" });
    await remove(id);
    expect(ended).toEqual([{ host: "host-1", name: "claude-far" }]);
  });

  it("ends nothing for a session that doesn't exist", async () => {
    const res = await remove(randomUUID());
    expect(res.status).toBe(404);
    expect(ended).toEqual([]);
  });
});
