import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { mintDevice } from "@/lib/security/devices";
import { isPublicPath } from "@/lib/security/auth";

const accept = await import("./pending/[id]/accept/route");
const decline = await import("./pending/[id]/decline/route");
const link = await import("./link/route");
const cancel = await import("./link/[id]/route");
const hello = await import("../peer/hello/route");

const plain = mintDevice("phone").device.id;
const approver = mintDevice("tablet", null, true).device.id;

const req = (
  path: string,
  o: { trust?: string; device?: string; body?: string; method?: string } = {}
) =>
  new NextRequest(`http://localhost${path}`, {
    method: o.method ?? "POST",
    headers: {
      ...(o.trust && { "x-agentos-trust": o.trust }),
      ...(o.device && { "x-agentos-device": o.device }),
      "content-type": "application/json",
    },
    body: o.body ?? JSON.stringify({ code: "123456" }),
  });
const params = { params: Promise.resolve({ id: "nope" }) };

describe("linking routes", () => {
  it("take a code only from this machine, the tailnet or a Can approve device", async () => {
    for (const who of [
      {},
      { trust: "device", device: plain },
      { trust: "device", device: "unknown" },
      { trust: "peer" },
      { trust: "open" },
    ]) {
      const r = await accept.POST(
        req("/api/peers/pending/nope/accept", who),
        params
      );
      expect(r.status).toBe(403);
      expect((await decline.POST(req("/x", who), params)).status).toBe(403);
      expect((await link.POST(req("/x", { ...who, body: "{}" }))).status).toBe(
        403
      );
      expect(
        (
          await cancel.DELETE(
            req("/x", { ...who, method: "DELETE", body: "" }),
            params
          )
        ).status
      ).toBe(403);
    }
    // Past the gate: there is no such request.
    for (const who of [
      { trust: "loopback" },
      { trust: "tailnet" },
      { trust: "device", device: approver },
    ])
      expect(
        (await accept.POST(req("/api/peers/pending/nope/accept", who), params))
          .status
      ).toBe(404);
    expect(
      (await link.POST(req("/x", { trust: "loopback", body: "{}" }))).status
    ).toBe(400);
  });

  it("caps a hello at 4 KiB and refuses junk", async () => {
    const big = await hello.POST(
      req("/api/peer/hello", { body: "x".repeat(5000) })
    );
    expect(big.status).toBe(413);
    expect(
      (await hello.POST(req("/api/peer/hello", { body: "{" }))).status
    ).toBe(400);
    expect(big.headers.get("cache-control")).toBe("no-store");
  });

  it("are public only for the three hello paths", () => {
    for (const p of [
      "/api/peer/hello",
      "/api/peer/hello/reveal",
      "/api/peer/hello/status",
    ])
      expect(isPublicPath(p)).toBe(true);
    for (const p of [
      "/api/peer/hello/x",
      "/api/peer/hello/../../pair/start",
      "/api/peers/pending",
      "/api/peers/account",
      "/api/peers/link",
    ])
      expect(isPublicPath(p)).toBe(false);
  });
});
