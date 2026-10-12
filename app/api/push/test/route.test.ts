import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const relaySend = vi.fn();
vi.mock("@/lib/notify/push/relay", () => ({
  linked: () => true,
  NOT_LINKED: "this machine isn't linked to Connect",
  relaySend: (...a: unknown[]) => relaySend(...a),
}));

const { POST } = await import("./route");
const { GET } = await import("../../devices/route");
const { pairPhone, resetPush } = await import("@/lib/notify/push/testing");
const { db } = await import("@/lib/db");

const post = (body?: unknown) =>
  POST(
    new NextRequest("http://x/api/push/test", {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

beforeEach(() => {
  resetPush();
  relaySend.mockReset();
  relaySend.mockImplementation(async (b: { devices: unknown[] }) => ({
    kind: "results",
    results: b.devices.map(() => ({ status: "sent" })),
  }));
});

describe("POST /api/push/test", () => {
  it("409s with no phone registered", async () => {
    expect((await post({})).status).toBe(409);
    expect(relaySend).not.toHaveBeenCalled();
  });

  it("404s for a device with no push", async () => {
    pairPhone();
    expect((await post({ deviceId: "nope" })).status).toBe(404);
  });

  it("sends to the named device only and says what happened", async () => {
    const a = pairPhone();
    pairPhone();
    const res = await post({ deviceId: a });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [{ deviceId: a, status: "sent", error: null }],
      unavailable: null,
    });
    expect(relaySend).toHaveBeenCalledTimes(1);
  });

  it("explains when push isn't set up", async () => {
    pairPhone();
    relaySend.mockResolvedValue({
      kind: "unavailable",
      reason: "push isn't set up on the Connect service yet",
    });
    const res = await post({});
    const body = await res.json();
    expect(body.results[0].status).toBe("failed");
    expect(body.unavailable).toMatch(/isn't set up/);
  });
});

describe("GET /api/devices push status", () => {
  it("lists each device's push state and categories, never the token", async () => {
    const id = pairPhone(["asks", "review"]);
    const res = await GET(new NextRequest("http://x/api/devices"));
    const body = await res.json();
    const device = body.devices.find((d: { id: string }) => d.id === id);
    expect(device.push).toEqual({
      enabled: true,
      categories: ["asks", "review"],
      lastError: null,
      updatedAt: expect.any(String),
    });
    expect(body.push).toEqual({ linked: true, unavailable: null });
    const token = (
      db.prepare(`SELECT push_token FROM devices WHERE id = ?`).get(id) as {
        push_token: string;
      }
    ).push_token;
    expect(JSON.stringify(body)).not.toContain(token);
    expect(Object.keys(device)).not.toContain("push_token");
  });

  it("shows a device with no push as off, and a pruned one with its error", async () => {
    const { mintDevice, pruneDevicePush } =
      await import("@/lib/security/devices");
    const off = mintDevice("laptop").device.id;
    const dead = pairPhone();
    pruneDevicePush(dead, "token no longer valid (Unregistered)");
    const body = await (
      await GET(new NextRequest("http://x/api/devices"))
    ).json();
    const by = (id: string) =>
      body.devices.find((d: { id: string }) => d.id === id).push;
    expect(by(off)).toMatchObject({
      enabled: false,
      categories: [],
      lastError: null,
    });
    expect(by(dead)).toMatchObject({
      enabled: false,
      lastError: expect.stringMatching(/Unregistered/),
    });
  });
});
