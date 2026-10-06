import { describe, it, expect } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";
import { gateRequest } from "./gate";
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
    headers: { ...headers },
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
