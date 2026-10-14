import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { DEVICE_HEADER, TRUST_HEADER } from "@/lib/security/auth";
import { mintDevice, setDeviceCanApprove } from "@/lib/security/devices";
import type { CheckResult } from "@/lib/updates/check";

let check: CheckResult | null;
let throttled: number | undefined;
let refreshed: CheckResult | null = null;
vi.mock("@/lib/updates/check", async (orig) => ({
  ...(await orig<typeof import("@/lib/updates/check")>()),
  cachedCheck: () => check,
  checkForUpdate: async () => ({ result: refreshed ?? check, throttled }),
}));
vi.mock("@/lib/busy", () => ({
  inFlight: () => ({ reviews: 0, setups: 0, simulatorStarts: 0 }),
}));
vi.mock("@/lib/status/collect", () => ({
  collectStatuses: async () => ({
    statuses: {
      a: { status: "running" },
      b: { status: "running" },
      c: { status: "idle" },
    },
  }),
}));

const root = await import("./route");
const runRoute = await import("./run/route");
const checkRoute = await import("./check/route");
const settingsRoute = await import("./settings/route");

const req = (
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown
) =>
  new NextRequest(`http://localhost/api/updates${path}`, {
    method,
    headers: {
      ...headers,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

const loopback = { [TRUST_HEADER]: "loopback" };
const available = (): CheckResult => ({
  status: "ok",
  current: { version: "0.3.1", sha: "a" },
  latest: { version: "0.3.5", sha: "b", notes: ["x"], url: null },
  behind: 4,
  available: true,
  branch: "main",
  checkedAt: 1,
  error: null,
});

beforeEach(() => {
  check = available();
  throttled = undefined;
  refreshed = null;
  delete process.env.AGENTOS_UPDATE_BANNER;
  process.env.AGENTOS_DEV = "1";
  db.prepare(`DELETE FROM settings WHERE key LIKE 'updates.%'`).run();
});

describe("GET /api/updates", () => {
  it("describes the update, and says who may start it", async () => {
    const view = await (await root.GET(req("", "GET", loopback))).json();
    expect(view).toMatchObject({
      available: true,
      current: { version: "0.3.1" },
      latest: { version: "0.3.5" },
      bannerEnabled: true,
      working: { sessions: 2 },
    });
    // A dev server refuses, with the reason.
    expect(view.canUpdate).toMatchObject({ ok: false, code: "dev" });
  });

  it("a device without Can approve can read it but not update", async () => {
    const { device } = mintDevice("phone");
    setDeviceCanApprove(device.id, false);
    const headers = { [TRUST_HEADER]: "device", [DEVICE_HEADER]: device.id };
    const view = await (await root.GET(req("", "GET", headers))).json();
    expect(view.canUpdate).toMatchObject({ ok: false, code: "forbidden" });
    const res = await runRoute.POST(
      req("/run", "POST", headers, { when: "now" })
    );
    expect(res.status).toBe(403);
  });
});

describe("after an update", () => {
  it("asks again instead of offering the version that was just installed", async () => {
    const file = path.join(
      path.dirname(process.env.DB_PATH!),
      "agent-os-update.json"
    );
    fs.writeFileSync(
      file,
      JSON.stringify({
        id: "r",
        phase: "done",
        from: "a",
        fromVersion: "0.3.1",
        toVersion: "0.3.5",
        startedAt: 5,
        finishedAt: 10,
      })
    );
    refreshed = { ...available(), available: false, behind: 0, checkedAt: 20 };
    try {
      const view = await (await root.GET(req("", "GET", loopback))).json();
      expect(view.available).toBe(false);
      expect(view.run.phase).toBe("done");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});

describe("POST /api/updates/run", () => {
  it("rejects a body that isn't now or idle", async () => {
    for (const body of [{}, { when: "later" }, { when: 1 }])
      expect(
        (await runRoute.POST(req("/run", "POST", loopback, body))).status
      ).toBe(400);
  });

  it("answers 409 with the code when the update can't run", async () => {
    const res = await runRoute.POST(
      req("/run", "POST", loopback, { when: "now" })
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "dev" });
    expect(
      db.prepare(`SELECT 1 FROM settings WHERE key = 'updates.pending'`).get()
    ).toBeUndefined();
  });

  it("refuses an anonymous caller", async () => {
    expect(
      (await runRoute.POST(req("/run", "POST", {}, { when: "now" }))).status
    ).toBe(403);
    expect((await runRoute.DELETE(req("/run", "DELETE", {}))).status).toBe(403);
  });

  it("cancels a requested update", async () => {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('updates.pending', ?)`
    ).run(JSON.stringify({ requestedAt: Date.now() }));
    const view = await (
      await runRoute.DELETE(req("/run", "DELETE", loopback))
    ).json();
    expect(view.pending).toBeNull();
  });
});

describe("POST /api/updates/check", () => {
  it("answers 429 inside the floor", async () => {
    throttled = 40;
    const res = await checkRoute.POST(req("/check", "POST", loopback));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("40");
  });
});

describe("PUT /api/updates/settings", () => {
  it("turns the banner off and back on", async () => {
    let view = await (
      await settingsRoute.PUT(
        req("/settings", "PUT", loopback, { banner: false })
      )
    ).json();
    expect(view.bannerEnabled).toBe(false);
    view = await (
      await settingsRoute.PUT(
        req("/settings", "PUT", loopback, { banner: true })
      )
    ).json();
    expect(view.bannerEnabled).toBe(true);
  });

  it("is refused when pinned by the environment, and for a bad body", async () => {
    expect(
      (
        await settingsRoute.PUT(
          req("/settings", "PUT", loopback, { banner: "no" })
        )
      ).status
    ).toBe(400);
    process.env.AGENTOS_UPDATE_BANNER = "off";
    expect(
      (
        await settingsRoute.PUT(
          req("/settings", "PUT", loopback, { banner: true })
        )
      ).status
    ).toBe(409);
  });
});
