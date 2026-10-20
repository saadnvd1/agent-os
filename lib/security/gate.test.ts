import { describe, it, expect } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";
import { EventEmitter } from "events";
import type { Duplex } from "stream";
import { gateRequest, gateUpgrade, sourceLabel } from "./gate";
import {
  DEVICE_HEADER,
  PEER_HEADER,
  PEER_INTERNAL_HEADER,
  REMOTE_HEADER,
  SOURCE_HEADER,
  TRUST_HEADER,
  markTunnelSocket,
  type AuthPolicy,
} from "./auth";

const policy: AuthPolicy = { tailnet: ["100.64.0.1"], lookup: () => null };

function call(
  url: string,
  remote: string,
  headers: Record<string, string> = {}
) {
  const req = {
    url,
    method: "POST",
    headers: { host: "127.0.0.1:3011", ...headers },
    socket: { remoteAddress: remote, localAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
  const res = {
    statusCode: 200,
    setHeader() {},
    end() {},
  } as unknown as ServerResponse;
  return { allowed: gateRequest(req, res, policy), req, res };
}

// bin/aos, the MCP server and the orchestrator's in-process tools all call
// the API at AGENTOS_URL=http://127.0.0.1:<port> with no proxy headers.
describe("gateRequest for this machine's own tools", () => {
  it.each([
    "/api/sessions",
    "/api/exec",
    "/api/orchestrate/x",
    "/api/bus/send",
  ])("lets a loopback call to %s through", (url) => {
    const { allowed, req } = call(url, "127.0.0.1");
    expect(allowed).toBe(true);
    expect(req.headers[TRUST_HEADER]).toBe("loopback");
  });

  it("refuses the same call when it came through a proxy", () => {
    const { allowed, res } = call("/api/exec", "127.0.0.1", {
      "x-forwarded-for": "203.0.113.9",
    });
    expect(allowed).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("ignores a trust header the client sent", () => {
    const { allowed } = call("/api/exec", "192.168.1.20", {
      [TRUST_HEADER]: "loopback",
    });
    expect(allowed).toBe(false);
  });
});

describe("a garbage cookie from the network", () => {
  const cookie = "aos_device=%E0%A4%A";

  it("gets a 401 over HTTP, not a crash", () => {
    let result: ReturnType<typeof call> | undefined;
    expect(() => {
      result = call("/api/sessions", "192.168.1.20", { cookie });
    }).not.toThrow();
    expect(result!.allowed).toBe(false);
    expect(result!.res.statusCode).toBe(401);
  });

  it("gets its upgrade refused, not a crash", () => {
    const req = {
      url: "/ws/terminal",
      headers: { host: "10.0.0.5:3011", cookie },
      socket: { remoteAddress: "192.168.1.20", localAddress: "10.0.0.5" },
    } as unknown as IncomingMessage;
    const written: string[] = [];
    const socket = Object.assign(new EventEmitter(), {
      destroyed: false,
      write: (s: string) => written.push(s),
      destroy() {
        this.destroyed = true;
      },
    }) as unknown as Duplex & { destroyed: boolean };
    expect(gateUpgrade(req, socket, policy)).toBe(false);
    expect(written[0]).toContain("401");
    expect(socket.destroyed).toBe(true);
  });
});

describe("the device cookie", () => {
  it("slides its expiry forward on use", () => {
    const headers: Record<string, string> = {};
    const req = {
      url: "/api/sessions",
      method: "GET",
      headers: { host: "10.0.0.5:3011", cookie: "aos_device=aosd_x" },
      socket: { remoteAddress: "192.168.1.20", localAddress: "10.0.0.5" },
    } as unknown as IncomingMessage;
    const res = {
      statusCode: 200,
      setHeader: (k: string, v: string) => (headers[k] = v),
      end() {},
    } as unknown as ServerResponse;
    const withDevice = {
      ...policy,
      lookup: () => ({ id: `slide-${Date.now()}` }),
    };
    expect(gateRequest(req, res, withDevice)).toBe(true);
    expect(headers["Set-Cookie"]).toMatch(
      /^aos_device=aosd_x; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax$/
    );
  });
});

describe("sourceLabel", () => {
  it("labels Connect's tunnel so headers can't pick the bucket", () => {
    expect(sourceLabel("127.0.0.1", true)).toBe("connect");
    expect(sourceLabel(undefined)).toBe("unknown");
    expect(sourceLabel("::ffff:10.0.0.9")).toBe("10.0.0.9");
  });

  it("stamps who sent it, Cloudflare's visitor on the tunnel, never the client's copy", () => {
    const socket = { remoteAddress: "127.0.0.1", localAddress: "127.0.0.1" };
    markTunnelSocket(socket as never);
    const req = {
      url: "/api/peer/hello",
      method: "POST",
      headers: {
        host: "m.runagentos.com",
        "cf-connecting-ip": "2001:db8:aa:bb:1:2:3:4",
        [SOURCE_HEADER]: "chosen",
      },
      socket,
    } as unknown as IncomingMessage;
    const res = { statusCode: 200, setHeader() {}, end() {} };
    gateRequest(req, res as unknown as ServerResponse, policy);
    expect(req.headers[SOURCE_HEADER]).toBe("2001:db8:aa:bb::/64");
    expect(
      call("/api/x", "192.168.1.20", { [SOURCE_HEADER]: "chosen" }).req.headers[
        SOURCE_HEADER
      ]
    ).toBe("192.168.1.20");
  });
});

describe("an unpaired browser opening a session's address", () => {
  function page(url: string) {
    const headers: Record<string, string> = {};
    const req = {
      url,
      method: "GET",
      headers: { host: "h:3011", accept: "text/html" },
      socket: { remoteAddress: "192.168.1.20", localAddress: "127.0.0.1" },
    } as unknown as IncomingMessage;
    const res = {
      statusCode: 200,
      setHeader(k: string, v: string) {
        headers[k] = v;
      },
      end() {},
    } as unknown as ServerResponse;
    return { allowed: gateRequest(req, res, policy), res, headers };
  }

  it("is sent to pair, keeping the way back, and let into nothing", () => {
    const { allowed, res, headers } = page("/?session=abc");
    expect(allowed).toBe(false);
    expect(res.statusCode).toBe(302);
    expect(headers.Location).toBe("/pair?next=%2F%3Fsession%3Dabc");
  });

  it("never carries another site as the way back", () => {
    expect(page("//evil.example/").headers.Location).toBe("/pair");
    expect(page("/\t/evil.example").headers.Location).toBe("/pair");
    expect(page("/.//evil.example?session=a").headers.Location).toBe("/pair");
  });
});

describe("a linked machine's call (peer trust)", () => {
  const SECRET = "s".repeat(64);
  const peerPolicy: AuthPolicy = {
    ...policy,
    lookup: (t) => (t === "aosd_phone" ? { id: "phone" } : null),
    peerSecret: () => SECRET,
  };

  function peerCall(
    url: string,
    opts: {
      method?: string;
      remote?: string;
      headers?: Record<string, string>;
      tunnel?: boolean;
    } = {}
  ) {
    const socket = {
      remoteAddress: opts.remote ?? "127.0.0.1",
      localAddress: "127.0.0.1",
    };
    if (opts.tunnel) markTunnelSocket(socket);
    const req = {
      url,
      method: opts.method ?? "GET",
      headers: {
        host: "127.0.0.1:3011",
        [PEER_INTERNAL_HEADER]: SECRET,
        [PEER_HEADER]: "host-b",
        ...opts.headers,
      },
      socket,
    } as unknown as IncomingMessage;
    const res = {
      statusCode: 200,
      setHeader() {},
      end() {},
    } as unknown as ServerResponse;
    return { allowed: gateRequest(req, res, peerPolicy), req, res };
  }

  it("stamps peer trust and the synthetic device on an allowlisted route", () => {
    const { allowed, req } = peerCall("/api/sessions/status");
    expect(allowed).toBe(true);
    expect(req.headers[TRUST_HEADER]).toBe("peer");
    expect(req.headers[DEVICE_HEADER]).toBe("peer:host-b");
    expect(req.headers[PEER_HEADER]).toBe("host-b");
    expect(req.headers[REMOTE_HEADER]).toBe("peer");
  });

  it("never lets a route see the secret", () => {
    const { req } = peerCall("/api/sessions/status");
    expect(req.headers[PEER_INTERNAL_HEADER]).toBeUndefined();
    const refused = peerCall("/api/devices");
    expect(refused.req.headers[PEER_INTERNAL_HEADER]).toBeUndefined();
  });

  it("refuses a route outside the allowlist, even with the secret", () => {
    for (const [method, url] of [
      ["GET", "/api/devices"],
      ["POST", "/api/pair/start"],
      ["POST", "/api/hosts/h/link"],
      ["GET", "/api/sessions/status?all=1"],
      ["POST", "/api/sessions/status"],
    ]) {
      const { allowed, res, req } = peerCall(url, { method });
      expect(allowed, url).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(req.headers[TRUST_HEADER]).toBeUndefined();
    }
  });

  it("refuses a wrong secret outright, never as loopback", () => {
    for (const bad of ["", "x", "s".repeat(63), "S".repeat(64), `${SECRET}x`]) {
      const { allowed, req } = peerCall("/api/sessions", {
        headers: { [PEER_INTERNAL_HEADER]: bad },
      });
      expect(allowed).toBe(false);
      expect(req.headers[TRUST_HEADER]).toBeUndefined();
    }
  });

  it("refuses the header even on a path that is otherwise public", () => {
    const { allowed, res } = peerCall("/api/pair/claim", {
      method: "POST",
      headers: { [PEER_INTERNAL_HEADER]: "wrong" },
    });
    expect(allowed).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("refuses the internal header on a tunnel socket, right secret or not", () => {
    for (const url of ["/api/sessions/status", "/api/pair/claim", "/pair"]) {
      const { allowed, req } = peerCall(url, { tunnel: true });
      expect(allowed, url).toBe(false);
      expect(req.headers[TRUST_HEADER]).toBeUndefined();
    }
  });

  it("refuses it from anywhere but loopback, or through a proxy", () => {
    expect(peerCall("/api/sessions", { remote: "100.64.0.9" }).allowed).toBe(
      false
    );
    expect(peerCall("/api/sessions", { remote: "192.168.1.20" }).allowed).toBe(
      false
    );
    expect(
      peerCall("/api/sessions", {
        headers: { "x-forwarded-for": "203.0.113.9" },
      }).allowed
    ).toBe(false);
  });

  it("refuses a host id that isn't plain", () => {
    for (const host of ["", "a b", "../x", "a".repeat(129)])
      expect(
        peerCall("/api/sessions", { headers: { [PEER_HEADER]: host } }).allowed
      ).toBe(false);
  });

  it("is never peer without the secret configured", () => {
    const req = {
      url: "/api/sessions",
      method: "GET",
      headers: {
        host: "127.0.0.1:3011",
        [PEER_INTERNAL_HEADER]: SECRET,
        [PEER_HEADER]: "host-b",
      },
      socket: { remoteAddress: "127.0.0.1", localAddress: "127.0.0.1" },
    } as unknown as IncomingMessage;
    const res = { statusCode: 200, setHeader() {}, end() {} };
    expect(gateRequest(req, res as unknown as ServerResponse, policy)).toBe(
      false
    );
  });

  it("drops a peer header sent without the secret", () => {
    const { allowed, req } = call("/api/sessions", "127.0.0.1", {
      [PEER_HEADER]: "host-b",
    });
    expect(allowed).toBe(true);
    expect(req.headers[TRUST_HEADER]).toBe("loopback");
    expect(req.headers[PEER_HEADER]).toBeUndefined();
  });

  it("never opens a socket for a peer", () => {
    const req = {
      url: "/api/sessions/status",
      method: "GET",
      headers: {
        host: "127.0.0.1:3011",
        [PEER_INTERNAL_HEADER]: SECRET,
        [PEER_HEADER]: "host-b",
      },
      socket: { remoteAddress: "127.0.0.1", localAddress: "127.0.0.1" },
    } as unknown as IncomingMessage;
    const written: string[] = [];
    const socket = Object.assign(new EventEmitter(), {
      write: (s: string) => written.push(s),
      destroy() {},
    }) as unknown as Duplex;
    expect(gateUpgrade(req, socket, peerPolicy)).toBe(false);
    expect(written[0]).toContain("401");
  });

  it("leaves a phone's device token exactly as before", () => {
    const req = {
      url: "/api/sessions",
      method: "GET",
      headers: {
        host: "m-0123456789abcdef.runagentos.com",
        authorization: "Bearer aosd_phone",
      },
      socket: { remoteAddress: "127.0.0.1", localAddress: "127.0.0.1" },
    } as unknown as IncomingMessage;
    markTunnelSocket(req.socket);
    const res = { statusCode: 200, setHeader() {}, end() {} };
    expect(gateRequest(req, res as unknown as ServerResponse, peerPolicy)).toBe(
      true
    );
    expect(req.headers[TRUST_HEADER]).toBe("device");
    expect(req.headers[DEVICE_HEADER]).toBe("phone");
  });

  it("still refuses a tunnel request with no envelope or token", () => {
    const req = {
      url: "/api/sessions",
      method: "GET",
      headers: { host: "m-0123456789abcdef.runagentos.com" },
      socket: { remoteAddress: "127.0.0.1", localAddress: "127.0.0.1" },
    } as unknown as IncomingMessage;
    markTunnelSocket(req.socket);
    const res = { statusCode: 200, setHeader() {}, end() {} };
    expect(gateRequest(req, res as unknown as ServerResponse, peerPolicy)).toBe(
      false
    );
    expect(res.statusCode).toBe(401);
  });

  it("lets the rpc path itself through to its handler without a token", () => {
    const req = {
      url: "/api/peer/rpc",
      method: "POST",
      headers: { host: "m-0123456789abcdef.runagentos.com" },
      socket: { remoteAddress: "127.0.0.1", localAddress: "127.0.0.1" },
    } as unknown as IncomingMessage;
    markTunnelSocket(req.socket);
    const res = { statusCode: 200, setHeader() {}, end() {} };
    expect(gateRequest(req, res as unknown as ServerResponse, peerPolicy)).toBe(
      true
    );
    expect(req.headers[TRUST_HEADER]).toBeUndefined();
  });
});
