import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { DELETE, PATCH, PUT } from "./route";
import { DELETE as SELF_DELETE } from "../route";
import {
  deviceForToken,
  getDevicePush,
  mintDevice,
  revokeDevice,
} from "@/lib/security/devices";
import { DEVICE_HEADER } from "@/lib/security/auth";
import { getDb } from "@/lib/db";
import { defaultCategories } from "@/lib/notify/copy";

const call = (
  fn: (r: NextRequest) => Promise<Response>,
  method: string,
  device: string | null,
  body?: unknown
) =>
  fn(
    new NextRequest("http://x/api/devices/me/push", {
      method,
      headers: device ? { [DEVICE_HEADER]: device } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

const tok = (n: number) => "apns" + String(n).padStart(8, "0") + "ab".repeat(8);

describe("/api/devices/me/push", () => {
  it("refuses a request that isn't from a paired device", async () => {
    for (const [fn, m] of [
      [PUT, "PUT"],
      [PATCH, "PATCH"],
      [DELETE, "DELETE"],
    ] as const)
      expect((await call(fn, m, null, { token: tok(1) })).status).toBe(403);
    expect(
      (
        await SELF_DELETE(
          new NextRequest("http://x/api/devices/me", { method: "DELETE" })
        )
      ).status
    ).toBe(403);
  });

  it("registers, defaults the categories, and is idempotent", async () => {
    const { device } = mintDevice("phone");
    const res = await call(PUT, "PUT", device.id, {
      token: tok(2),
      environment: "sandbox",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      deviceId: device.id,
      enabled: true,
      platform: "ios",
      environment: "sandbox",
      categories: defaultCategories(),
    });
    const again = await call(PUT, "PUT", device.id, {
      token: tok(2),
      environment: "sandbox",
    });
    expect(again.status).toBe(200);
    expect(getDevicePush(device.id)?.token).toBe(tok(2));
  });

  it("a new token replaces the old and keeps saved categories", async () => {
    const { device } = mintDevice("phone");
    await call(PUT, "PUT", device.id, { token: tok(3) });
    await call(PATCH, "PATCH", device.id, { categories: ["asks", "merged"] });
    await call(PUT, "PUT", device.id, { token: tok(4) });
    expect(getDevicePush(device.id)).toMatchObject({
      token: tok(4),
      categories: ["asks", "merged"],
    });
  });

  it("moves a token from the device that held it", async () => {
    const a = mintDevice("old pairing").device;
    const b = mintDevice("new pairing").device;
    await call(PUT, "PUT", a.id, { token: tok(5) });
    await call(PUT, "PUT", b.id, { token: tok(5) });
    expect(getDevicePush(a.id)).toBeNull();
    expect(getDevicePush(b.id)?.token).toBe(tok(5));
  });

  it("rejects bad input", async () => {
    const { device } = mintDevice("phone");
    for (const b of [
      {},
      { token: "short" },
      { token: "bad token with spaces!!" },
      { token: tok(6), platform: "palm" },
      { token: tok(6), environment: "staging" },
      { token: tok(6), categories: ["asks", "nope"] },
      { token: tok(6), categories: "asks" },
    ])
      expect((await call(PUT, "PUT", device.id, b)).status).toBe(400);
    expect(getDevicePush(device.id)).toBeNull();
  });

  it("PATCH sets categories, needs a registration, and validates", async () => {
    const { device } = mintDevice("phone");
    expect(
      (await call(PATCH, "PATCH", device.id, { categories: ["asks"] })).status
    ).toBe(404);
    await call(PUT, "PUT", device.id, { token: tok(7) });
    expect(
      (await call(PATCH, "PATCH", device.id, { categories: ["x"] })).status
    ).toBe(400);
    expect((await call(PATCH, "PATCH", device.id, {})).status).toBe(400);
    const res = await call(PATCH, "PATCH", device.id, {
      categories: ["ci", "ci"],
    });
    expect((await res.json()).categories).toEqual(["ci"]);
    await call(PATCH, "PATCH", device.id, { categories: [] });
    expect(getDevicePush(device.id)?.categories).toEqual([]);
  });

  it("DELETE clears push for this device only", async () => {
    const a = mintDevice("a").device;
    const b = mintDevice("b").device;
    await call(PUT, "PUT", a.id, { token: tok(8) });
    await call(PUT, "PUT", b.id, { token: tok(9) });
    const res = await call(DELETE, "DELETE", a.id);
    expect(await res.json()).toMatchObject({ enabled: false });
    expect(getDevicePush(a.id)).toBeNull();
    expect(getDevicePush(b.id)).not.toBeNull();
  });

  it("never returns the token", async () => {
    const { device } = mintDevice("phone");
    const res = await call(PUT, "PUT", device.id, { token: tok(10) });
    expect(JSON.stringify(await res.json())).not.toContain(tok(10));
  });
});

describe("device revocation and push", () => {
  it("revoking clears every push column", async () => {
    const { device } = mintDevice("phone");
    await call(PUT, "PUT", device.id, { token: tok(11), categories: ["asks"] });
    expect(revokeDevice(device.id)).toBe(true);
    const row = getDb()
      .prepare(
        `SELECT push_token, push_platform, push_environment, push_categories,
                push_updated_at, push_last_error FROM devices WHERE id = ?`
      )
      .get(device.id);
    expect(Object.values(row as object).every((v) => v === null)).toBe(true);
    expect(getDevicePush(device.id)).toBeNull();
  });

  it("DELETE /api/devices/me revokes the caller and its push", async () => {
    const { device, token } = mintDevice("phone");
    await call(PUT, "PUT", device.id, { token: tok(12) });
    const res = await SELF_DELETE(
      new NextRequest("http://x/api/devices/me", {
        method: "DELETE",
        headers: { [DEVICE_HEADER]: device.id },
      })
    );
    expect(res.status).toBe(200);
    expect(deviceForToken(token)).toBeNull();
    expect(getDevicePush(device.id)).toBeNull();
    // A second sign-out finds nothing.
    expect(
      (
        await SELF_DELETE(
          new NextRequest("http://x/api/devices/me", {
            method: "DELETE",
            headers: { [DEVICE_HEADER]: device.id },
          })
        )
      ).status
    ).toBe(404);
  });

  it("a revoked device can't register push", async () => {
    const { device } = mintDevice("phone");
    revokeDevice(device.id);
    expect((await call(PUT, "PUT", device.id, { token: tok(13) })).status).toBe(
      404
    );
  });
});
