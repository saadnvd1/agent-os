import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TRUST_HEADER } from "./security/auth";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-link-route-"));
let delay = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const b = JSON.parse(body || "{}");
    setTimeout(() => {
      if (b.link_code !== "GOOD-CODE")
        return res
          .writeHead(422, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: "code expired" }));
      res.writeHead(201, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          machine_id: "abcd1234",
          hostname: "m-0123456789abcdef.runagentos.com",
        })
      );
    }, delay);
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.AGENTOS_CONNECT_DIR = dir;
process.env.CONNECT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.AGENTOS_CONNECT_OPERATOR = "1";

const route = await import("@/app/api/devices/connect/route");

const req = (body: unknown, via: string | null = "loopback") =>
  new NextRequest("http://localhost/api/devices/connect", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(via && { [TRUST_HEADER]: via }),
    },
    body: JSON.stringify(body),
  });

const reset = () => {
  for (const f of ["connect.json", "machine.key"])
    fs.rmSync(path.join(dir, f), { force: true });
};
beforeEach(() => {
  reset();
  delay = 0;
});
afterAll(() => {
  server.close();
  reset();
});

describe("POST /api/devices/connect", () => {
  it("refuses callers that aren't on this machine or the tailnet", async () => {
    expect((await route.POST(req({ code: "GOOD-CODE" }, null))).status).toBe(
      403
    );
    expect(
      (await route.POST(req({ code: "GOOD-CODE" }, "device"))).status
    ).toBe(403);
    expect(fs.existsSync(path.join(dir, "connect.json"))).toBe(false);
  });

  it("asks for a usable code", async () => {
    for (const code of [undefined, "", "x".repeat(200), "a b"])
      expect((await route.POST(req({ code }))).status).toBe(400);
  });

  it("links, then refuses a second link", async () => {
    const res = await route.POST(req({ code: "GOOD-CODE" }));
    expect(res.status).toBe(200);
    expect((await res.json()).connect).toBeDefined();
    expect(fs.existsSync(path.join(dir, "connect.json"))).toBe(true);
    const again = await route.POST(req({ code: "GOOD-CODE" }));
    expect(again.status).toBe(409);
  });

  it("reports a refused code without writing anything or echoing it", async () => {
    const res = await route.POST(req({ code: "secret-bad" }));
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("code expired");
    expect(text).not.toContain("secret-bad");
    expect(fs.existsSync(path.join(dir, "connect.json"))).toBe(false);
  });

  it("allows one link at a time", async () => {
    delay = 150;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [a, b] = await Promise.all([
      route.POST(req({ code: "GOOD-CODE" })),
      route.POST(req({ code: "GOOD-CODE" })),
    ]);
    spy.mockRestore();
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});
