import type { IncomingMessage, ServerResponse } from "http";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { gateRequest } from "./gate";
import { TRUST_HEADER, type AuthPolicy } from "./auth";

const policy: AuthPolicy = {
  tailnet: ["100.64.0.1"],
  lookup: (t) => (t === "aosd_good" ? { id: "dev-1" } : null),
};

// A request from another machine on the LAN, as the paired phone's is.
function gate(url: string, headers: Record<string, string> = {}) {
  const req = {
    url,
    method: "GET",
    headers: { host: "192.168.1.9:3011", ...headers },
    socket: { remoteAddress: "192.168.1.20", localAddress: "192.168.1.9" },
  } as unknown as IncomingMessage;
  const out = { status: 200 };
  const res = {
    get statusCode() {
      return out.status;
    },
    set statusCode(v: number) {
      out.status = v;
    },
    setHeader() {},
    end() {},
  } as unknown as ServerResponse;
  const allowed = gateRequest(req, res, policy);
  return { allowed, status: out.status, req };
}

const URLS = [
  "/api/start-options?projectId=p",
  "/api/tasks/t1/diff",
  "/api/tasks/t1/diff?file=a.ts",
  "/api/tasks/t1/checks",
  "/api/tasks",
];

describe("loop routes and the device-token gate", () => {
  it.each(URLS)("refuses %s with no token", (url) => {
    const r = gate(url);
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(401);
  });

  it.each(URLS)("refuses %s with a wrong token", (url) => {
    expect(gate(url, { authorization: "Bearer aosd_bad" }).allowed).toBe(false);
  });

  it.each(URLS)("lets a paired device's token reach %s", (url) => {
    const r = gate(url, { authorization: "Bearer aosd_good" });
    expect(r.allowed).toBe(true);
    expect(r.req.headers[TRUST_HEADER]).toBe("device");
  });

  it("answers a device-trusted request on every new route, never 403", async () => {
    const headers = { [TRUST_HEADER]: "device" };
    const ctx = { params: Promise.resolve({ id: "none" }) };
    const start = await import("@/app/api/start-options/route");
    const diff = await import("@/app/api/tasks/[id]/diff/route");
    const checks = await import("@/app/api/tasks/[id]/checks/route");
    const req = (p: string) =>
      new NextRequest(`http://localhost${p}`, { headers });
    expect((await start.GET(req("/api/start-options"))).status).toBe(200);
    expect((await diff.GET(req("/api/tasks/none/diff"), ctx)).status).toBe(404);
    expect((await checks.GET(req("/api/tasks/none/checks"), ctx)).status).toBe(
      404
    );
  });
});
