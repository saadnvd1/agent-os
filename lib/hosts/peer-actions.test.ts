import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db, type Session } from "../db";
import { fakePeer } from "../__fixtures__/fake-peer";
import { linkedHost } from "../__fixtures__/linked-host";
import { doneSession } from "../done";
import { DEFAULT_START_VIEW, launchSession } from "../sessions/launch";
import { MAX_PEER_MIRRORS, syncPeerMirrors } from "./peer-sync";
import { toPeerSession, type PeerSession } from "./peer-sessions";
import { PATCH, DELETE } from "../../app/api/sessions/[id]/route";
import { POST as fork } from "../../app/api/sessions/[id]/fork/route";
import { POST as unarchive } from "../../app/api/sessions/[id]/unarchive/route";
import { sessionTargetProblem } from "../schedules/store";
import { workspaceSessions } from "../orchestrator/facts";
import { peerSessionLink } from "./peer-actions";

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

// A listing asked for after everything so far was made.
const later = () => Date.now() + 2000;

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
      Date.now()
    );
    expect(row(a)).toMatchObject({ host_id: hostId, project_id: projectId });
    expect(row(a)?.updated_at).toBe("2026-10-10 12:00:00");
    expect(row(b)).toMatchObject({ host_id: hostId, project_id: null });
  });

  it("follows the listing, and drops a mirror only once that machine stops listing it", async () => {
    const { hostId } = await setup();
    const id = randomUUID();
    syncPeerMirrors(hostId, [listed(hostId, id)], Date.now());
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
      Date.now()
    );
    expect(row(id)).toMatchObject({
      name: "renamed there",
      pr_number: 7,
      pr_status: "open",
    });
    syncPeerMirrors(hostId, [], later());
    expect(row(id)).toBeUndefined();
  });

  it("never drops a session made after the listing was asked for, or from a cut-short one", async () => {
    const { hostId } = await setup();
    const id = randomUUID();
    syncPeerMirrors(hostId, [listed(hostId, id)], Date.now());
    // An older answer arriving late.
    syncPeerMirrors(hostId, [], Date.now() - 5000);
    expect(row(id)).toBeDefined();
    const many = Array.from({ length: MAX_PEER_MIRRORS + 1 }, () =>
      listed(hostId, randomUUID())
    );
    syncPeerMirrors(hostId, many, later());
    expect(row(id)).toBeDefined();
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE host_id = ?`)
          .get(hostId) as { n: number }
      ).n
    ).toBe(MAX_PEER_MIRRORS + 1);
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
    syncPeerMirrors(
      hostId,
      [listed(hostId, mine, { name: "theirs" })],
      later()
    );
    expect(row(mine)).toMatchObject({ name: "mine", host_id: "local" });
    expect(row(task)?.name).toBe("task");
  });
});

describe("actions on a linked machine's session", () => {
  async function mirrored() {
    const { peer, hostId } = await setup();
    const id = randomUUID();
    syncPeerMirrors(hostId, [listed(hostId, id)], Date.now());
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

  it("refuses a rename that machine refuses, and an empty one", async () => {
    const { peer, id } = await mirrored();
    peer.routes[`/api/sessions/${id}`] = () => ({ $status: 409, error: "no" });
    const res = await PATCH(req({ name: "new" }), params(id));
    expect(res.status).toBe(502);
    expect(row(id)?.name).toBe("fix it");
    const empty = await PATCH(req({ name: "  " }), params(id));
    expect(empty.status).toBe(400);
    expect(peer.calls).toHaveLength(1);
  });

  it("refuses a move to another project without asking that machine", async () => {
    const { peer, id } = await mirrored();
    const res = await PATCH(req({ projectId: "elsewhere" }), params(id));
    expect(res.status).toBe(400);
    expect(peer.calls).toEqual([]);
  });

  it("deletes it there, then the mirror", async () => {
    const { peer, id } = await mirrored();
    peer.routes[`/api/sessions/${id}`] = ({ method }) =>
      method === "GET" ? { session: { id } } : { success: true };
    const res = await DELETE(req(undefined, "DELETE"), params(id));
    expect(res.status).toBe(200);
    expect(peer.calls.map((c) => c.method)).toEqual(["GET", "DELETE"]);
    expect(row(id)).toBeUndefined();
  });

  it("removes a mirror that machine no longer has, asking nothing else", async () => {
    const { peer, id } = await mirrored();
    peer.routes[`/api/sessions/${id}`] = () => ({
      $status: 404,
      error: "Session not found",
    });
    const res = await DELETE(req(undefined, "DELETE"), params(id));
    expect(res.status).toBe(200);
    expect(peer.calls.map((c) => c.method)).toEqual(["GET"]);
    expect(row(id)).toBeUndefined();
  });

  it("keeps the mirror when that machine refuses the delete", async () => {
    const { peer, id } = await mirrored();
    peer.routes[`/api/sessions/${id}`] = ({ method }) =>
      method === "GET"
        ? { session: { id } }
        : { $status: 409, error: "not now" };
    const res = await DELETE(req(undefined, "DELETE"), params(id));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/not now/);
    expect(row(id)).toBeDefined();
  });

  it("never deletes one of that machine's tasks from here", async () => {
    const { peer, id } = await mirrored();
    peer.routes[`/api/sessions/${id}`] = () => ({
      session: { id, task_prompt: "ship it" },
    });
    const res = await DELETE(req(undefined, "DELETE"), params(id));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/is a task on box/);
    expect(peer.calls.map((c) => c.method)).toEqual(["GET"]);
    expect(row(id)).toBeDefined();
  });

  it("is done there and archived here, and undone there too", async () => {
    const { peer, id } = await mirrored();
    peer.routes[`/api/sessions/${id}`] = () => ({ session: { id } });
    peer.routes[`/api/sessions/${id}/done`] = () => ({
      outcome: { text: "Done: fix it.", worktree: { action: "none" } },
    });
    peer.routes[`/api/sessions/${id}/unarchive`] = () => ({ session: { id } });
    const outcome = await doneSession(id, { by: "direct", onPeer: true });
    expect(outcome.text).toBe("box: Done: fix it.");
    expect(outcome.merged).toBeNull();
    expect(peer.calls).toEqual([
      { method: "GET", path: `/api/sessions/${id}`, body: undefined },
      { method: "POST", path: `/api/sessions/${id}/done`, body: {} },
    ]);
    expect(row(id)?.archived_at).toBeTruthy();
    const res = await unarchive(req(undefined, "POST"), params(id));
    expect(res.status).toBe(200);
    expect(peer.calls.at(-1)).toMatchObject({
      method: "POST",
      path: `/api/sessions/${id}/unarchive`,
    });
    expect(row(id)?.archived_at).toBeNull();
  });

  it("never asks that machine to done its tasks, its orchestrator, or what it can't name", async () => {
    const { peer, id } = await mirrored();
    for (const [there, why] of [
      [{ id, task_prompt: "ship it" }, /is a task on box/],
      [{ id, task_status: "running" }, /is a task on box/],
      [{ id, role: "orchestrator" }, /isn't marked done on box/],
      [{ id: "someone-else" }, /didn't say what/],
      [null, /didn't say what/],
    ] as const) {
      peer.routes[`/api/sessions/${id}`] = () => ({ session: there });
      await expect(
        doneSession(id, { by: "direct", onPeer: true })
      ).rejects.toThrow(why);
    }
    expect(peer.calls.every((c) => c.method === "GET")).toBe(true);
    expect(row(id)?.archived_at).toBeNull();
  });

  it("never lets an agent or the orchestrator done it", async () => {
    const { peer, id } = await mirrored();
    for (const by of ["direct", "orchestrator"] as const)
      await expect(doneSession(id, { by })).rejects.toThrow(
        /only you can mark it done/
      );
    expect(peer.calls).toEqual([]);
  });

  it("refuses done on one already archived, asking nothing", async () => {
    const { peer, id } = await mirrored();
    db.prepare(
      `UPDATE sessions SET archived_at = datetime('now') WHERE id = ?`
    ).run(id);
    await expect(
      doneSession(id, { by: "direct", onPeer: true })
    ).rejects.toThrow(/already archived/);
    expect(peer.calls).toEqual([]);
  });

  it("refuses a fork with the reason the menu shows", async () => {
    const { peer, id } = await mirrored();
    const res = await fork(req({}, "POST"), params(id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Runs on box: fork it there");
    expect(peer.calls).toEqual([]);
  });

  it("is left to that machine's orchestrator, not this one's", async () => {
    const { hostId } = await setup();
    const projectId = project(hostId, "~/dev/app");
    db.prepare(`UPDATE projects SET workspace_id = 'ws-peer' WHERE id = ?`).run(
      projectId
    );
    const id = randomUUID();
    syncPeerMirrors(hostId, [listed(hostId, id)], Date.now());
    expect(row(id)?.project_id).toBe(projectId);
    expect(workspaceSessions("ws-peer").map((s) => s.id)).not.toContain(id);
  });

  it("refuses a check-in on it", async () => {
    const { id } = await mirrored();
    expect(sessionTargetProblem(id, "any")).toMatch(/runs on a linked machine/);
  });

  it("leaves a session this machine started there over ssh to its own paths", async () => {
    const { peer, hostId } = await setup();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, host_id)
       VALUES (?, 'ssh one', 'claude-z', '~', ?)`
    ).run(id, hostId);
    expect(peerSessionLink(row(id)!)).toBeNull();
    // Not listed there, so never dropped by a listing.
    syncPeerMirrors(hostId, [], later());
    expect(row(id)).toBeDefined();
    expect(peer.calls).toEqual([]);
  });
});

describe("starting a session on a linked machine", () => {
  it("refuses an answer naming a session this machine already has", async () => {
    const { peer, hostId } = await setup();
    const mine = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, host_id)
       VALUES (?, 'mine', 'claude-m', '~', 'local')`
    ).run(mine);
    cleanups.push(() =>
      db.prepare(`DELETE FROM sessions WHERE id = ?`).run(mine)
    );
    peer.routes["/api/projects"] = () => ({ projects: [] });
    peer.routes["/api/sessions"] = () => ({
      session: { id: mine, view: "terminal", tmux_name: "x" },
      initialPrompt: "do something else",
    });
    await expect(
      launchSession({ hostId, agentType: "claude", prompt: "hi" })
    ).rejects.toThrow(/isn't its new one/);
    expect(row(mine)).toMatchObject({ host_id: "local", name: "mine" });
  });

  it("starts it there in chat, in the project at the same folder, and mirrors it", async () => {
    const { peer, hostId } = await setup();
    const projectId = project(hostId, "~/dev/app");
    const id = randomUUID();
    peer.routes["/api/projects"] = () => ({
      projects: [
        { id: "uncategorized", is_uncategorized: 1, working_directory: "~" },
        { id: "theirs", working_directory: "/home/me/dev/app" },
      ],
    });
    peer.routes["/api/sessions"] = ({ body }) => ({
      session: {
        id,
        name: "hi there",
        tmux_name: `claude-${id}`,
        view: "chat",
        agent_type: "claude",
        working_directory: "/home/me/dev/app",
        prompt: (body as { prompt: string }).prompt,
      },
    });
    const { session } = await launchSession({
      projectId,
      agentType: "claude",
      prompt: "hi",
    });
    expect(peer.calls.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/sessions",
      body: {
        projectId: "theirs",
        agentType: "claude",
        prompt: "hi",
        view: DEFAULT_START_VIEW,
      },
    });
    expect(DEFAULT_START_VIEW).toBe("chat");
    expect(session).toMatchObject({
      id,
      host_id: hostId,
      project_id: projectId,
      view: "chat",
      peer_mirror: 1,
    });
  });
});
