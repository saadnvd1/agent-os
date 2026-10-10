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
    // A chat's tmux name, when it gives one, is checked too.
    expect(
      toPeerSession("box", { id: "a", view: "chat", tmux_name: "-x y" })
    ).toBeNull();
  });

  it("leaves its orchestrator and its tasks to it", () => {
    const base = { id: "a", view: "chat" };
    expect(toPeerSession("box", { ...base, role: "orchestrator" })).toBeNull();
    expect(toPeerSession("box", { ...base, task_prompt: "ship" })).toBeNull();
    expect(
      toPeerSession("box", { ...base, task_status: "running" })
    ).toBeNull();
  });

  it("keeps a PR and a time only in the shapes AgentOS writes them", () => {
    const pr = (extra: object) =>
      toPeerSession("box", { id: "a", view: "chat", ...extra });
    expect(
      pr({
        pr_url: "https://github.com/o/r/pull/7",
        pr_number: 7,
        pr_status: "open",
        updated_at: "2026-10-10 12:00:00",
        model: "m".repeat(300),
      })
    ).toMatchObject({
      prUrl: "https://github.com/o/r/pull/7",
      prNumber: 7,
      prStatus: "open",
      updatedAt: "2026-10-10 12:00:00",
      model: "m".repeat(100),
    });
    for (const url of [
      "javascript:alert(1)",
      "http://github.com/o/r/pull/7",
      "https://evil.example/o/r/pull/7",
      "https://github.com/o/r/pull/7 x",
    ])
      expect(
        pr({ pr_url: url, pr_number: 7, pr_status: "open" })
      ).toMatchObject({
        prUrl: null,
        prNumber: null,
        prStatus: null,
      });
    const good = { pr_url: "https://github.com/o/r/pull/7" };
    for (const n of [-1, 0, "7", 1e20, 1.5])
      expect(pr({ ...good, pr_number: n })?.prNumber).toBeNull();
    expect(pr({ ...good, pr_status: "pwned" })?.prStatus).toBeNull();
    for (const t of ["2026-10-10T12:00:00Z", "2026-10-10 12:00:00; x", 5])
      expect(pr({ updated_at: t })?.updatedAt).toBeNull();
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

  it("drops a mirror once that machine stops listing it", async () => {
    const { peer, link } = await setup();
    const rows = () =>
      (
        getDb()
          .prepare(`SELECT id FROM sessions WHERE host_id = ? ORDER BY id`)
          .all(link.hostId) as { id: string }[]
      ).map((r) => r.id);
    let listed = ["m-1", "m-2"];
    peer.routes["/api/tmux/discover"] = () => ({ sessions: [] });
    peer.routes["/api/sessions"] = () => ({
      sessions: listed.map((id) => ({ id, name: id, view: "chat" })),
    });
    await peerTmuxSessions(link);
    expect(rows()).toEqual(["m-1", "m-2"]);
    listed = ["m-1"];
    await peerTmuxSessions(link);
    expect(rows()).toEqual(["m-1"]);
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
