import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db, type Session } from "../db";
import { fakePeer } from "../__fixtures__/fake-peer";
import { linkedHost } from "../__fixtures__/linked-host";
import { doneSession } from "../done";
import { syncPeerMirrors } from "./peer-sync";
import { toPeerSession, type PeerSession } from "./peer-sessions";
import { PATCH, DELETE } from "../../app/api/sessions/[id]/route";
import { POST as fork } from "../../app/api/sessions/[id]/fork/route";

const TOKEN = "tok";
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function setup() {
  const peer = await fakePeer(TOKEN);
  const host = linkedHost(peer.url, TOKEN);
  cleanups.push(peer.close, host.remove);
  return { peer, hostId: host.hostId };
}

const listed = (hostId: string, id: string, extra: object = {}) =>
  toPeerSession(hostId, {
    id,
    name: "fix it",
    tmux_name: `claude-${id}`,
    view: "chat",
    agent_type: "claude",
    working_directory: "/home/me/dev/app",
    updated_at: "2026-10-10 12:00:00",
    ...extra,
  }) as PeerSession;

const row = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;

function project(hostId: string, dir: string): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO projects (id, name, working_directory, host_id) VALUES (?, 'app', ?, ?)`
  ).run(id, dir, hostId);
  cleanups.push(() => db.prepare(`DELETE FROM projects WHERE id = ?`).run(id));
  return id;
}

const req = (body: unknown, method = "PATCH") =>
  new NextRequest("http://x/api/sessions/x", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("syncPeerMirrors", () => {
  it("places a session under the project its folder maps to on that machine, or none", async () => {
    const { hostId } = await setup();
    const projectId = project(hostId, "~/dev/app");
    // Same folder, but a project on this machine: not that machine's.
    project("local", "~/dev/other");
    const a = randomUUID();
    const b = randomUUID();
    syncPeerMirrors(
      hostId,
      [
        listed(hostId, a),
        listed(hostId, b, { working_directory: "/home/me/dev/other" }),
      ],
      []
    );
    expect(row(a)).toMatchObject({ host_id: hostId, project_id: projectId });
    expect(row(a)?.updated_at).toBe("2026-10-10 12:00:00");
    expect(row(b)).toMatchObject({ host_id: hostId, project_id: null });
  });

  it("follows the listing, and drops a mirror only once that machine stops listing it", async () => {
    const { hostId } = await setup();
    const id = randomUUID();
    syncPeerMirrors(hostId, [listed(hostId, id)], []);
    syncPeerMirrors(
      hostId,
      [
        listed(hostId, id, {
          name: "renamed there",
          pr_url: "https://github.com/o/r/pull/7",
          pr_number: 7,
          pr_status: "open",
        }),
      ],
      []
    );
    expect(row(id)).toMatchObject({
      name: "renamed there",
      pr_number: 7,
      pr_status: "open",
    });
    syncPeerMirrors(hostId, [], [id]);
    expect(row(id)).toBeUndefined();
  });

  it("leaves this machine's own rows and task mirrors alone", async () => {
    const { hostId } = await setup();
    const mine = randomUUID();
    const task = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, host_id)
       VALUES (?, 'mine', 'claude-x', '~', 'local')`
    ).run(mine);
    cleanups.push(() =>
      db.prepare(`DELETE FROM sessions WHERE id = ?`).run(mine)
    );
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, host_id, task_prompt)
       VALUES (?, 'task', 'claude-y', '~', ?, 'do it')`
    ).run(task, hostId);
    syncPeerMirrors(hostId, [listed(hostId, mine, { name: "theirs" })], [task]);
    expect(row(mine)).toMatchObject({ name: "mine", host_id: "local" });
    expect(row(task)?.name).toBe("task");
  });
});

describe("actions on a linked machine's session", () => {
  async function mirrored() {
    const { peer, hostId } = await setup();
    const id = randomUUID();
    syncPeerMirrors(hostId, [listed(hostId, id)], []);
    return { peer, hostId, id };
  }

  it("renames it there, with the link's token, then here", async () => {
    const { peer, id } = await mirrored();
    peer.routes[`/api/sessions/${id}`] = ({ body }) => ({
      session: { name: (body as { name: string }).name, tmux_name: "renamed" },
    });
    const res = await PATCH(req({ name: "new name" }), params(id));
    expect(res.status).toBe(200);
    expect(peer.calls).toEqual([
      {
        method: "PATCH",
        path: `/api/sessions/${id}`,
        body: { name: "new name" },
      },
    ]);
    expect(row(id)).toMatchObject({ name: "new name", tmux_name: "renamed" });
  });

  it("refuses other changes with the reason", async () => {
    const { peer, id } = await mirrored();
    const res = await PATCH(req({ view: "terminal" }), params(id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Runs on box/);
    expect(peer.calls).toEqual([]);
  });

  it("deletes it there, then the mirror; one already gone there goes too", async () => {
    const { peer, id } = await mirrored();
    peer.routes[`/api/sessions/${id}`] = () => ({
      $status: 404,
      error: "Session not found",
    });
    const res = await DELETE(req(undefined, "DELETE"), params(id));
    expect(res.status).toBe(200);
    expect(peer.calls[0]).toMatchObject({ method: "DELETE" });
    expect(row(id)).toBeUndefined();
  });

  it("keeps the mirror when that machine refuses the delete", async () => {
    const { peer, id } = await mirrored();
    peer.routes[`/api/sessions/${id}`] = () => ({
      $status: 409,
      error: "not now",
    });
    const res = await DELETE(req(undefined, "DELETE"), params(id));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/not now/);
    expect(row(id)).toBeDefined();
  });

  it("is done there and archived here", async () => {
    const { peer, id } = await mirrored();
    peer.routes[`/api/sessions/${id}`] = () => ({ session: { id } });
    peer.routes[`/api/sessions/${id}/done`] = () => ({
      outcome: { text: "Done: fix it.", worktree: { action: "none" } },
    });
    const outcome = await doneSession(id, { by: "direct" });
    expect(outcome.text).toBe("box: Done: fix it.");
    expect(outcome.merged).toBeNull();
    expect(peer.calls.map((c) => c.path)).toEqual([
      `/api/sessions/${id}`,
      `/api/sessions/${id}/done`,
    ]);
    expect(row(id)?.archived_at).toBeTruthy();
  });

  it("never asks that machine to done one of its tasks", async () => {
    const { peer, id } = await mirrored();
    peer.routes[`/api/sessions/${id}`] = () => ({
      session: { id, task_prompt: "ship it" },
    });
    await expect(doneSession(id, { by: "direct" })).rejects.toThrow(
      /is a task on box/
    );
    expect(peer.calls.map((c) => c.path)).toEqual([`/api/sessions/${id}`]);
    expect(row(id)?.archived_at).toBeNull();
  });

  it("refuses a fork with the reason the menu shows", async () => {
    const { peer, id } = await mirrored();
    const res = await fork(req({}, "POST"), params(id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Runs on box: fork it there");
    expect(peer.calls).toEqual([]);
  });
});
