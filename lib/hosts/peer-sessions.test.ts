import { getDb } from "../db";
import { describe, expect, it } from "vitest";
import { toPeerSession, toTmuxInfo } from "./peer-sessions";

describe("what a linked machine says", () => {
  it("keeps its own sessions, checked and cleaned", () => {
    const s = toPeerSession("box", {
      id: "abc-1",
      name: "fix\u001b[31m it",
      tmux_name: "claude-abc-1",
      view: "chat",
      agent_type: "claude",
      working_directory: "/home/me/x",
      orch_token: "secret",
    });
    expect(s).toMatchObject({ id: "abc-1", name: "fix [31m it", view: "chat" });
    expect(JSON.stringify(s)).not.toContain("secret");
  });

  it("drops its mirrors of other machines and anything malformed", () => {
    expect(
      toPeerSession("box", { id: "a", host_id: "mac", tmux_name: "x" })
    ).toBeNull();
    expect(toPeerSession("box", { id: "../etc", tmux_name: "x" })).toBeNull();
    expect(toPeerSession("box", { id: "a", tmux_name: "bad name" })).toBeNull();
    expect(toTmuxInfo("box", { name: "a;b" })).toBeNull();
    expect(toTmuxInfo("box", { name: "ok", title: 7 })?.hostId).toBe("box");
  });
});

describe("asking a linked machine", async () => {
  const { afterEach } = await import("vitest");
  const { fakePeer } = await import("../__fixtures__/fake-peer");
  const { linkedHost } = await import("../__fixtures__/linked-host");
  const { hostLink } = await import("./remote-api");
  const { peerTmuxSessions, peerManagedSessions, peerStatus, peerPane } =
    await import("./peer-sessions");
  const cleanups: (() => unknown)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });
  async function setup() {
    const peer = await fakePeer("tok");
    const host = linkedHost(peer.url, "tok");
    cleanups.push(peer.close, host.remove);
    return { peer, host, link: hostLink(host.hostId)! };
  }

  it("keeps only its own sessions, with their state", async () => {
    const { peer, link } = await setup();
    peer.routes["/api/tmux/discover"] = () => ({
      sessions: [
        { name: "main", hostId: "local", title: "t" },
        { name: "theirs", hostId: "some-other-machine" },
      ],
    });
    peer.routes["/api/sessions"] = () => ({
      sessions: [
        { id: "s-1", name: "chat", view: "chat", tmux_name: "" },
        { id: "s-2", name: "x", host_id: "mac", tmux_name: "x" },
      ],
    });
    peer.routes["/api/sessions/status"] = () => ({
      statuses: { "s-1": { status: "running" } },
    });
    const tmux = await peerTmuxSessions(link);
    expect(tmux.map((t) => [t.hostId, t.name])).toEqual([
      [link.hostId, "main"],
    ]);
    const managed = peerManagedSessions().filter(
      (s) => s.hostId === link.hostId
    );
    expect(managed.map((s) => [s.id, s.state])).toEqual([["s-1", "running"]]);
    expect(peerStatus(link.hostId, "s-1")).toBe("running");
  });

  it("keeps the last list when asking fails, and drops it once unlinked", async () => {
    const { peer, host, link } = await setup();
    peer.routes["/api/tmux/discover"] = () => ({ sessions: [] });
    peer.routes["/api/sessions"] = () => ({
      sessions: [{ id: "s-1", name: "chat", view: "chat" }],
    });
    await peerTmuxSessions(link);
    delete peer.routes["/api/sessions"];
    await peerTmuxSessions(link);
    const mine = () =>
      peerManagedSessions().filter((s) => s.hostId === link.hostId);
    expect(mine().map((s) => s.id)).toEqual(["s-1"]);
    getDb()
      .prepare(`DELETE FROM host_links WHERE host_id = ?`)
      .run(host.hostId);
    expect(mine()).toEqual([]);
  });

  it("reads a pane, and an empty or failed one as unknown", async () => {
    const { peer, link } = await setup();
    peer.routes["/api/sessions/s-1/preview"] = () => ({ lines: ["a", "b"] });
    expect(await peerPane(link, "s-1")).toEqual(["a", "b"]);
    peer.routes["/api/sessions/s-1/preview"] = () => ({ lines: [] });
    expect(await peerPane(link, "s-1")).toBeNull();
    expect(await peerPane(link, "nope")).toBeNull();
  });
});
