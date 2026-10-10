import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getDb } from "../db";
import { fakePeer } from "../__fixtures__/fake-peer";
import { linkedHost } from "../__fixtures__/linked-host";
import { mirrorPeerSession } from "./peer-mirror";
import { POST } from "../../app/api/hosts/[id]/sessions/route";

const TOKEN = "tok";
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function setup(sessions: unknown[]) {
  const peer = await fakePeer(TOKEN);
  peer.routes["/api/sessions"] = () => ({ sessions });
  const host = linkedHost(peer.url, TOKEN);
  cleanups.push(peer.close, host.remove);
  return host.hostId;
}

const peerChat = (id: string, extra: object = {}) => ({
  id,
  name: "fix it",
  tmux_name: `claude-${id}`,
  view: "chat",
  agent_type: "claude",
  working_directory: "/tmp",
  model: "opus",
  ...extra,
});

describe("mirrorPeerSession", () => {
  it("mirrors what the other machine says, once", async () => {
    const id = randomUUID();
    const hostId = await setup([peerChat(id)]);
    const row = await mirrorPeerSession(hostId, id);
    expect(row).toMatchObject({
      id,
      host_id: hostId,
      view: "chat",
      tmux_name: `claude-${id}`,
      agent_type: "claude",
    });
    expect((await mirrorPeerSession(hostId, id)).id).toBe(id);
  });

  it("refuses a session that machine doesn't list now", async () => {
    const hostId = await setup([]);
    await expect(mirrorPeerSession(hostId, randomUUID())).rejects.toThrow(
      /has no such session/
    );
  });

  it("refuses that machine's mirror of a third machine's session", async () => {
    const id = randomUUID();
    const hostId = await setup([peerChat(id, { host_id: "mac" })]);
    await expect(mirrorPeerSession(hostId, id)).rejects.toThrow(
      /has no such session/
    );
  });

  it("never re-points a session that's already here", async () => {
    const id = randomUUID();
    const hostId = await setup([peerChat(id)]);
    getDb()
      .prepare(
        `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, 'mine', 'mine', '/tmp')`
      )
      .run(id);
    cleanups.push(() =>
      getDb().prepare(`DELETE FROM sessions WHERE id = ?`).run(id)
    );
    await expect(mirrorPeerSession(hostId, id)).rejects.toThrow(
      /already exists here/
    );
  });

  it("refuses a machine that isn't linked", async () => {
    await expect(
      mirrorPeerSession(randomUUID(), randomUUID())
    ).rejects.toThrow();
  });
});

describe("POST /api/hosts/:id/sessions", () => {
  it("wants a sessionId", async () => {
    const res = await POST(
      new NextRequest("http://127.0.0.1/api/hosts/x/sessions", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ id: "x" }) }
    );
    expect(res.status).toBe(400);
  });
});
