import { EventEmitter } from "events";
import { afterEach, describe, expect, it } from "vitest";
import { fakePeer, until } from "../__fixtures__/fake-peer";
import type { HostLink } from "../hosts/remote-api";
import { relayChatSocket } from "./peer-relay";

const TOKEN = "device-token-for-the-mac";
let peer: Awaited<ReturnType<typeof fakePeer>> | null = null;
afterEach(async () => {
  await peer?.close();
  peer = null;
});

class Browser extends EventEmitter {
  closedWith: [number?, string?] | null = null;
  close(code?: number, reason?: string) {
    this.closedWith = [code, reason];
  }
  say(m: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(m)));
  }
}

function relay(token = TOKEN) {
  const link: HostLink = {
    hostId: "box",
    hostName: "box",
    url: peer!.url,
    token,
  };
  const browser = new Browser();
  const sent: Record<string, unknown>[] = [];
  const failed: string[] = [];
  relayChatSocket(
    browser,
    link,
    { session: "s1", paged: "1" },
    (json) => sent.push(JSON.parse(json)),
    (m) => failed.push(m)
  );
  return { browser, sent, failed };
}

describe("relayChatSocket", () => {
  it("serves a linked machine's chat through its AgentOS, both ways", async () => {
    peer = await fakePeer(TOKEN);
    peer.onSocket(({ ws }) => {
      ws.send(JSON.stringify({ type: "snapshot", items: [], state: "idle" }));
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === "send")
          ws.send(
            JSON.stringify({ type: "item", item: { id: "u1", text: m.text } })
          );
      });
    });
    const r = relay();
    // Sent before the other side answered: kept, then delivered.
    r.browser.say({ type: "send", text: "hi from the mac" });
    await until(() => r.sent.length === 2);
    expect(r.sent[0]).toMatchObject({ type: "snapshot" });
    expect(r.sent[1]).toMatchObject({
      type: "item",
      item: { text: "hi from the mac" },
    });
    const s = peer.sockets[0];
    expect(s.url.pathname).toBe("/ws/chat");
    expect(s.url.searchParams.get("session")).toBe("s1");
    expect(s.url.searchParams.get("paged")).toBe("1");
    expect(peer.upgrades[0].authorization).toBe(`Bearer ${TOKEN}`);
    expect(peer.upgrades[0].url).not.toContain(TOKEN);
    // The browser leaving closes the other side.
    r.browser.emit("close");
    await until(() => s.ws.readyState === s.ws.CLOSED);
  });

  it("passes on the other side's close, so a gone session reads as gone", async () => {
    peer = await fakePeer(TOKEN);
    peer.onSocket(({ ws }) => ws.close(4404, "session not found"));
    const r = relay();
    await until(() => r.browser.closedWith !== null);
    expect(r.browser.closedWith).toEqual([4404, "session not found"]);
    expect(r.failed).toEqual([]);
  });

  it("refuses, saying why, when the token isn't valid there", async () => {
    peer = await fakePeer(TOKEN);
    const r = relay("stale-token");
    await until(() => r.browser.closedWith !== null);
    expect(r.browser.closedWith?.[0]).toBe(1011);
    expect(r.failed[0]).toContain("refused this machine's link (401)");
    expect(peer.sockets).toHaveLength(0);
  });

  it("says once that the other machine can't be reached, and keeps trying", async () => {
    peer = await fakePeer(TOKEN);
    const url = peer.url;
    await peer.close();
    peer = null;
    const browser = new Browser();
    const failed: string[] = [];
    relayChatSocket(
      browser,
      { hostId: "box", hostName: "box", url, token: TOKEN },
      { session: "s1" },
      () => {},
      (m) => failed.push(m)
    );
    await until(() => failed.length === 1);
    expect(failed[0]).toContain("Can't reach AgentOS on box");
    // A send meanwhile is refused, not held for later.
    browser.say({ type: "send", text: "lost?" });
    expect(failed[1]).toContain("Not sent");
    await new Promise((r) => setTimeout(r, 1200));
    expect(failed).toHaveLength(2);
    expect(browser.closedWith).toBeNull();
    browser.emit("close");
  });

  it("reconnects when the other side drops, with a fresh snapshot", async () => {
    peer = await fakePeer(TOKEN);
    peer.onSocket(({ ws }) =>
      ws.send(JSON.stringify({ type: "snapshot", items: [], state: "idle" }))
    );
    const r = relay();
    await until(() => r.sent.length === 1);
    peer.sockets[0].ws.terminate();
    await until(() => r.sent.length === 2, 4000);
    expect(r.sent[1]).toMatchObject({ type: "snapshot" });
    expect(r.failed).toEqual(["Lost AgentOS on box; reconnecting"]);
    expect(r.browser.closedWith).toBeNull();
    r.browser.emit("close");
  });
});

describe("relayChatSocket over time", async () => {
  const { vi } = await import("vitest");
  const { PEER_GIVE_UP_MS } = await import("../terminal/peer-pty");
  type Sock = InstanceType<typeof EventEmitter> & {
    readyState: number;
    send(d: string): void;
    close(): void;
    terminate(): void;
  };
  function harness() {
    let t = 0;
    const socks: Sock[] = [];
    const browser = new Browser();
    const failed: string[] = [];
    relayChatSocket(
      browser,
      { hostId: "box", hostName: "box", url: "http://box:3011", token: "t" },
      { session: "s1" },
      () => {},
      (m) => failed.push(m),
      () => {
        const s = Object.assign(new EventEmitter(), {
          readyState: 0,
          send() {},
          close() {},
          terminate() {},
        }) as Sock;
        socks.push(s);
        return s;
      },
      () => t
    );
    return { browser, socks, failed, at: (ms: number) => (t = ms) };
  }

  it("stops retrying once the peer has been gone too long", () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.socks[0].emit("close", 1006, "");
      h.at(PEER_GIVE_UP_MS + 1);
      vi.advanceTimersByTime(1000);
      h.socks[1].emit("close", 1006, "");
      expect(h.browser.closedWith?.[0]).toBe(1011);
      vi.advanceTimersByTime(60_000);
      expect(h.socks).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a proxy's 5xx rather than ending the chat", () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.socks[0].emit("unexpected-response", {}, { statusCode: 503 });
      expect(h.browser.closedWith).toBeNull();
      vi.advanceTimersByTime(1000);
      expect(h.socks).toHaveLength(2);
      h.browser.emit("close");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cuts off the peer while the browser is far behind", () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.socks[0].readyState = 1;
      h.socks[0].emit("open");
      (h.browser as unknown as { bufferedAmount: number }).bufferedAmount =
        64 * 1024 * 1024;
      const sent: string[] = [];
      h.socks[0].emit("message", Buffer.from("{}"));
      expect(sent).toEqual([]);
      expect(h.failed[0]).toContain("faster than it can be shown");
      h.browser.emit("close");
    } finally {
      vi.useRealTimers();
    }
  });
});
