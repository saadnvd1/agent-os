import { afterEach, describe, expect, it } from "vitest";
import { fakePeer, until } from "../__fixtures__/fake-peer";
import type { HostLink } from "../hosts/remote-api";
import { PeerPty } from "./peer-pty";

const TOKEN = "device-token-for-the-mac";
let peer: Awaited<ReturnType<typeof fakePeer>> | null = null;
afterEach(async () => {
  await peer?.close();
  peer = null;
});

function start(token = TOKEN) {
  const link: HostLink = {
    hostId: "box",
    hostName: "box",
    url: peer!.url,
    token,
  };
  const pty = new PeerPty(
    link,
    { sessionName: "main", attachOnly: true },
    80,
    24
  );
  let out = "";
  let exit: number | null = null;
  pty.onData((d) => (out += d));
  pty.onExit(({ exitCode }) => (exit = exitCode));
  return { pty, out: () => out, exit: () => exit };
}

describe("PeerPty", () => {
  it("attaches through the other AgentOS and relays both ways", async () => {
    peer = await fakePeer(TOKEN);
    peer.onSocket(({ ws }) => {
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === "attach")
          ws.send(JSON.stringify({ type: "output", data: "box$ " }));
        if (m.type === "input")
          ws.send(JSON.stringify({ type: "output", data: m.data }));
      });
    });
    const t = start();
    await until(() => t.out().includes("box$ "));
    t.pty.write("ls\r");
    t.pty.resize(120, 40);
    await until(() => t.out().includes("ls\r"));
    const s = peer.sockets[0];
    expect(s.url.pathname).toBe("/ws/terminal");
    expect(s.url.searchParams.get("flow")).toBe("1");
    expect(s.got[0]).toEqual({ type: "resize", cols: 80, rows: 24 });
    expect(s.got[1]).toMatchObject({
      type: "attach",
      spec: { sessionName: "main", attachOnly: true },
    });
    expect(s.got).toContainEqual({ type: "resize", cols: 120, rows: 40 });
    // Each output acked as it arrived.
    await until(() => s.got.filter((m) => m.type === "ack").length === 2);
    // The token rides the Authorization header, never the URL; no Origin.
    expect(peer.upgrades[0].authorization).toBe(`Bearer ${TOKEN}`);
    expect(peer.upgrades[0].url).not.toContain(TOKEN);
    expect(peer.upgrades[0].origin).toBeUndefined();
    t.pty.kill();
  });

  it("holds acks while paused, so the other side's tmux waits", async () => {
    peer = await fakePeer(TOKEN);
    const t = start();
    await until(
      () => peer!.sockets.length === 1 && peer!.sockets[0].got.length >= 2
    );
    const s = peer.sockets[0];
    t.pty.pause();
    s.ws.send(JSON.stringify({ type: "output", data: "a" }));
    s.ws.send(JSON.stringify({ type: "output", data: "b" }));
    await until(() => t.out() === "ab");
    await new Promise((r) => setTimeout(r, 50));
    expect(s.got.filter((m) => m.type === "ack")).toHaveLength(0);
    t.pty.resume();
    await until(() => s.got.filter((m) => m.type === "ack").length === 2);
    t.pty.kill();
  });

  it("ends, saying why, when the other machine refuses the token", async () => {
    peer = await fakePeer(TOKEN);
    const t = start("not-the-token");
    await until(() => t.exit() !== null);
    expect(t.exit()).toBe(1);
    expect(t.out()).toContain("refused this machine's link (401)");
    expect(peer.sockets).toHaveLength(0);
  });

  it("ends when the session detaches there", async () => {
    peer = await fakePeer(TOKEN);
    peer.onSocket(({ ws }) =>
      ws.on("message", (raw) => {
        if (JSON.parse(raw.toString()).type === "attach")
          ws.send(JSON.stringify({ type: "detached", code: 0 }));
      })
    );
    const t = start();
    await until(() => t.exit() !== null);
    expect(t.exit()).toBe(0);
  });

  it("reconnects and attaches again when the connection drops", async () => {
    peer = await fakePeer(TOKEN);
    const t = start();
    await until(
      () => peer!.sockets.length === 1 && peer!.sockets[0].got.length >= 2
    );
    peer.sockets[0].ws.terminate();
    await until(() => t.out().includes("Reconnecting to box"));
    await until(
      () => peer!.sockets.length === 2 && peer!.sockets[1].got.length >= 2,
      4000
    );
    expect(peer.sockets[1].got[1]).toMatchObject({ type: "attach" });
    expect(t.exit()).toBeNull();
    t.pty.kill();
  });
});

describe("PeerPty against a misbehaving or absent peer", async () => {
  const { EventEmitter } = await import("events");
  const { vi } = await import("vitest");
  const { PEER_GIVE_UP_MS } = await import("./peer-pty");
  const link: HostLink = {
    hostId: "box",
    hostName: "box",
    url: "http://box:3011",
    token: "t",
  };
  type Sock = InstanceType<typeof EventEmitter> & {
    readyState: number;
    sent: string[];
    send(d: string): void;
    close(): void;
    terminate(): void;
  };
  function harness() {
    let t = 0;
    const socks: Sock[] = [];
    const open = () => {
      const s = Object.assign(new EventEmitter(), {
        readyState: 0,
        sent: [] as string[],
        send(d: string) {
          s.sent.push(d);
        },
        close() {},
        terminate() {},
      }) as Sock;
      socks.push(s);
      return s;
    };
    const pty = new PeerPty(
      link,
      { sessionName: "main", attachOnly: true },
      80,
      24,
      open,
      () => t
    );
    let out = "";
    let exit: number | null = null;
    pty.onData((d) => (out += d));
    pty.onExit(({ exitCode }) => (exit = exitCode));
    const opened = (s: Sock) => {
      s.readyState = 1;
      s.emit("open");
    };
    return {
      pty,
      socks,
      opened,
      at: (ms: number) => (t = ms),
      out: () => out,
      exit: () => exit,
    };
  }

  it("gives up, saying so, once the peer has been gone too long", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await Promise.resolve();
      h.opened(h.socks[0]);
      h.socks[0].emit("close");
      h.at(PEER_GIVE_UP_MS + 1);
      vi.advanceTimersByTime(1000);
      expect(h.socks).toHaveLength(2);
      h.socks[1].emit("close");
      expect(h.exit()).toBe(1);
      expect(h.out()).toContain("Lost box's AgentOS");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a proxy's 5xx after it was connected, instead of ending", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await Promise.resolve();
      h.opened(h.socks[0]);
      h.socks[0].emit("unexpected-response", {}, { statusCode: 502 });
      expect(h.exit()).toBeNull();
      vi.advanceTimersByTime(1000);
      expect(h.socks).toHaveLength(2);
      h.pty.kill();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores frames that aren't objects, without throwing", async () => {
    const h = harness();
    await Promise.resolve();
    h.opened(h.socks[0]);
    for (const f of ["null", "7", '"x"', "[]", "{"])
      expect(() => h.socks[0].emit("message", Buffer.from(f))).not.toThrow();
    expect(h.exit()).toBeNull();
    h.pty.kill();
  });

  it("cuts off a peer that ignores flow control", async () => {
    const h = harness();
    await Promise.resolve();
    h.opened(h.socks[0]);
    h.pty.pause();
    const big = JSON.stringify({ type: "output", data: "x".repeat(1 << 20) });
    for (let i = 0; i < 6; i++) h.socks[0].emit("message", Buffer.from(big));
    expect(h.exit()).toBe(1);
    expect(h.out()).toContain("more than this terminal could take");
  });
});
