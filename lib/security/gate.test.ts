import { describe, it, expect } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";
import { EventEmitter } from "events";
import type { Duplex } from "stream";
import { gateRequest, gateUpgrade, sourceLabel } from "./gate";
import { TRUST_HEADER, type AuthPolicy } from "./auth";

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
  it("labels address-less Connect streams so headers can't pick the bucket", () => {
    expect(sourceLabel(undefined)).toBe("connect");
    expect(sourceLabel("")).toBe("connect");
    expect(sourceLabel("::ffff:10.0.0.9")).toBe("10.0.0.9");
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
