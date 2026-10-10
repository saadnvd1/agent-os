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

  it("says when the other machine can't be reached", async () => {
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
    await until(() => browser.closedWith !== null);
    expect(browser.closedWith?.[0]).toBe(1011);
    expect(failed[0]).toContain("Can't reach AgentOS on box");
  });
});
