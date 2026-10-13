import fs from "fs";
import os from "os";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSchema } from "@/lib/db/schema";
import { runMigrations } from "@/lib/db/migrations";
import { POST as claim } from "@/app/api/pair/claim/route";
import * as awayRoute from "@/app/api/away/route";
import { activeAway } from "@/lib/away/state";
import { turnAwayOff } from "@/lib/away/run";
import { markTunnelSocket } from "./auth";
import { gateRequest } from "./gate";
import { startPairing } from "./pairing";
import {
  deviceForToken,
  getDevice,
  revokeDevice,
  setDeviceCanApprove,
} from "./devices";

vi.mock("@/lib/notify", () => ({ notifyPhone: () => {} }));
process.env.AGENTOS_AUDITS_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "native-approve-audits-")
);

const APP_UA = "AgentOS/18 CFNetwork/3826.600.41.2.1 Darwin/24.6.0";
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

async function pair(body: object, headers: Record<string, string>) {
  const { code } = startPairing();
  const res = await claim(
    new NextRequest("http://localhost:3011/api/pair/claim", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ code, name: "phone", ...body }),
    })
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    device: { id: string };
    token?: string;
  };
  return { id: json.device.id, token: json.token };
}

const nativePair = () => pair({ token: true }, { "user-agent": APP_UA });

describe("Can approve at pairing", () => {
  it("is on for the native app", async () => {
    const { id, token } = await nativePair();
    expect(token).toBeTruthy();
    expect(getDevice(id)?.can_approve).toBe(1);
  });

  it("stays off for a browser, even one asking for the token", async () => {
    const origin = { origin: "http://localhost:3011", "user-agent": APP_UA };
    for (const body of [{}, { token: true }]) {
      const { id, token } = await pair(body, origin);
      expect(token).toBeUndefined();
      expect(getDevice(id)?.can_approve).toBe(0);
    }
    const noToken = await pair({}, { "user-agent": SAFARI_UA });
    expect(getDevice(noToken.id)?.can_approve).toBe(0);
  });

  it("a device turned off stays off through later pairings", async () => {
    const { id } = await nativePair();
    setDeviceCanApprove(id, false);
    await nativePair();
    await pair({}, { origin: "http://localhost:3011" });
    expect(getDevice(id)?.can_approve).toBe(0);
  });
});

describe("migration 83 (native_devices_can_approve)", () => {
  function oldDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-approve-"));
    const db = new Database(path.join(dir, "old.db"));
    createSchema(db);
    runMigrations(db, 82);
    const add = db.prepare(
      `INSERT INTO devices (id, name, token_hash, user_agent, push_platform, revoked_at, can_approve)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    add.run("ios", "iPhone", "h1", APP_UA, "ios", null, 0);
    add.run(
      "sim",
      "Simulator",
      "h2",
      "AgentOS/1 CFNetwork/3860 Darwin/25.5.0",
      null,
      null,
      0
    );
    add.run("android", "Pixel", "h3", "okhttp/4.12.0", "android", null, 0);
    add.run("safari", "Safari", "h4", SAFARI_UA, null, null, 0);
    add.run("curl", "curl", "h5", "curl/8.7.1", null, null, 0);
    add.run(
      "gone",
      "Old iPhone",
      "h6",
      APP_UA,
      "ios",
      "2026-10-01 10:00:00",
      0
    );
    add.run("browser-on", "Mac", "h7", SAFARI_UA, null, null, 1);
    const flags = () =>
      Object.fromEntries(
        (
          db.prepare(`SELECT id, can_approve FROM devices`).all() as {
            id: string;
            can_approve: number;
          }[]
        ).map((r) => [r.id, r.can_approve])
      );
    return { db, flags };
  }

  it("turns it on only for live native devices, and takes nothing away", () => {
    const { db, flags } = oldDb();
    runMigrations(db);
    expect(flags()).toEqual({
      ios: 1,
      sim: 1,
      android: 1,
      safari: 0,
      curl: 0,
      gone: 0,
      "browser-on": 1,
    });
  });

  it("runs once: a device turned off afterwards stays off across restarts", () => {
    const { db, flags } = oldDb();
    runMigrations(db);
    db.prepare(`UPDATE devices SET can_approve = 0 WHERE id = 'ios'`).run();
    runMigrations(db);
    runMigrations(db);
    expect(flags()).toMatchObject({ ios: 0, sim: 1, android: 1, safari: 0 });
  });
});

describe("Away over Connect", () => {
  // Through the real gate, as a request on Connect's tunnel socket.
  function overConnect(token: string, body: object) {
    const socket = { remoteAddress: "127.0.0.1", localAddress: "127.0.0.1" };
    markTunnelSocket(socket);
    const req = {
      url: "/api/away",
      method: "POST",
      headers: {
        host: "localhost:3011",
        authorization: `Bearer ${token}`,
      } as Record<string, string>,
      socket,
    } as unknown as IncomingMessage;
    const res = {
      statusCode: 200,
      setHeader() {},
      end() {},
    } as unknown as ServerResponse;
    expect(gateRequest(req, res, { tailnet: [], lookup: deviceForToken })).toBe(
      true
    );
    return awayRoute.POST(
      new NextRequest("http://localhost:3011/api/away", {
        method: "POST",
        headers: { ...(req.headers as Record<string, string>) },
        body: JSON.stringify(body),
      })
    );
  }

  it("lets a native device turn Away on and off, until it's revoked", async () => {
    const { id, token } = await nativePair();
    const on = await overConnect(token!, { on: true, expiresAt: null });
    expect(on.status).toBe(200);
    expect(activeAway()).not.toBeNull();
    expect((await overConnect(token!, { on: false })).status).toBe(200);
    expect(activeAway()).toBeNull();

    setDeviceCanApprove(id, false);
    expect((await overConnect(token!, { on: false })).status).toBe(403);
    setDeviceCanApprove(id, true);
    revokeDevice(id);
    expect(deviceForToken(token!)).toBeNull();
    turnAwayOff("saad");
  });
});
