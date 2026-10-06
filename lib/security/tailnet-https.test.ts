import { describe, it, expect } from "vitest";
import https from "https";
import { makeTestPki } from "@/lib/connect/test-pki";
import {
  startTailnetHttps,
  tailnetHttpsPort,
  tailnetHttpsUrl,
} from "./tailnet-https";

describe("tailnet HTTPS", () => {
  it("defaults to AgentOS's port + 432, and refuses an unusable port", () => {
    expect(tailnetHttpsPort(3011, {})).toBe(3443);
    expect(tailnetHttpsPort(3011, { AGENTOS_TAILNET_HTTPS_PORT: "8443" })).toBe(
      8443
    );
    for (const bad of ["70000", "-1", "abc", "3011", "1.5"]) {
      expect(
        tailnetHttpsPort(3011, { AGENTOS_TAILNET_HTTPS_PORT: bad })
      ).toBeNull();
    }
  });

  it("stays off, without throwing, when the port is unusable", () => {
    const logs: string[] = [];
    const prev = process.env.AGENTOS_TAILNET_HTTPS_PORT;
    process.env.AGENTOS_TAILNET_HTTPS_PORT = "99999";
    const t = startTailnetHttps({
      handlers: { onRequest: () => {}, onUpgrade: () => {} },
      port: 3011,
      addresses: () => ["127.0.0.1"],
      log: (l) => logs.push(l),
    });
    if (prev === undefined) delete process.env.AGENTOS_TAILNET_HTTPS_PORT;
    else process.env.AGENTOS_TAILNET_HTTPS_PORT = prev;
    expect(t.port).toBe(0);
    expect(logs.join()).toContain("isn't a usable port");
  });

  it("serves HTTPS with real sockets, so trust still sees the true remote address", async () => {
    const pki = makeTestPki();
    const leaf = pki.leaf("mac.ts.test");
    const t = startTailnetHttps({
      handlers: {
        onRequest: (req, res) =>
          res.end(`${req.socket.remoteAddress}|${req.socket.localAddress}`),
        onUpgrade: (_r, s) => s.destroy(),
      },
      port: 30000 + Math.floor(Math.random() * 2000),
      addresses: () => ["127.0.0.1"],
      log: () => {},
      getCert: async () => ({ ...leaf, name: "mac.ts.test" }),
    });
    await t.ready;
    await new Promise((r) => setTimeout(r, 100));
    expect(tailnetHttpsUrl()).toBe(`https://mac.ts.test:${t.port}`);
    const body = await new Promise<string>((resolve, reject) =>
      https
        .get(
          {
            host: "127.0.0.1",
            port: t.port,
            servername: "mac.ts.test",
            ca: pki.ca,
          },
          (res) => {
            let b = "";
            res.on("data", (c) => (b += c));
            res.on("end", () => resolve(b));
          }
        )
        .on("error", reject)
    );
    expect(body).toMatch(/^(::ffff:)?127\.0\.0\.1\|(::ffff:)?127\.0\.0\.1$/);
    t.stop();
    expect(tailnetHttpsUrl()).toBeNull();
  });
});
