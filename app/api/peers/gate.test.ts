import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { mintDevice } from "@/lib/security/devices";
import { isPublicPath } from "@/lib/security/auth";

const accept = await import("./pending/[id]/accept/route");
const decline = await import("./pending/[id]/decline/route");
const link = await import("./link/route");
const cancel = await import("./link/[id]/route");
const confirm = await import("./link/[id]/confirm/route");
const hello = await import("../peer/hello/route");
const unlink = await import("./[hostId]/route");
const audit = await import("./[hostId]/audit/route");
const hostDelete = await import("../hosts/[id]/route");

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
    body:
      o.method === "GET"
        ? undefined
        : (o.body ?? JSON.stringify({ code: "123456" })),
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
      expect((await confirm.POST(req("/x", who), params)).status).toBe(403);
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
      (await confirm.POST(req("/x", { trust: "loopback" }), params)).status
    ).toBe(404);
    expect(
      (await link.POST(req("/x", { trust: "loopback", body: "{}" }))).status
    ).toBe(400);
    for (const body of ['{"code":482913}', "{", "{}"])
      for (const route of [accept, confirm])
        expect(
          (await route.POST(req("/x", { trust: "loopback", body }), params))
            .status
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
      "/api/peers/link/x/confirm",
      "/api/peers/h1",
      "/api/peers/h1/audit",
      "/api/peer/unlink",
    ])
      expect(isPublicPath(p)).toBe(false);
  });

  it("unlink and Activity take the same trust as linking", async () => {
    const hostParams = { params: Promise.resolve({ hostId: "nope" }) };
    for (const who of [
      {},
      { trust: "device", device: plain },
      { trust: "peer" },
      { trust: "open" },
    ]) {
      const del = req("/api/peers/nope", {
        ...who,
        method: "DELETE",
        body: "",
      });
      expect((await unlink.DELETE(del, hostParams)).status).toBe(403);
      const get = req("/api/peers/nope/audit", { ...who, method: "GET" });
      expect((await audit.GET(get, hostParams)).status).toBe(403);
    }
    const asApprover = { trust: "device", device: approver };
    expect(
      (
        await unlink.DELETE(
          req("/x", { ...asApprover, method: "DELETE", body: "" }),
          hostParams
        )
      ).status
    ).toBe(404);
    const rows = await audit.GET(
      req("/x", { ...asApprover, method: "GET" }),
      hostParams
    );
    expect(await rows.json()).toEqual({ rows: [] });
  });

  it("won't remove a Connect-linked machine without unlinking it", async () => {
    const { createConnectHost } = await import("@/lib/hosts");
    const { savePin, pinForHost } = await import("@/lib/peer/links");
    const id = createConnectHost("Linked").id;
    savePin({
      hostId: id,
      machineId: "f0f0f0f0",
      hostname: "m-0000000000000000.runagentos.com",
      signPub: "x",
      boxPub: "y",
    });
    const res = await hostDelete.DELETE(
      req("/x", { method: "DELETE", body: "" }),
      {
        params: Promise.resolve({ id }),
      }
    );
    expect(res.status).toBe(409);
    expect(pinForHost(id)).not.toBeNull();
  });
});
