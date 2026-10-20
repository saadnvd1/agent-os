import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mintDevice } from "@/lib/security/devices";

const seen: unknown[] = [];
vi.mock("@/lib/peer/pairing", () => ({
  pendingRequests: (_now: number, o: unknown) => {
    seen.push(o);
    return [];
  },
}));
const { GET } = await import("./route");

const get = (headers: Record<string, string>) =>
  GET(new NextRequest("http://localhost/api/peers/pending", { headers }));

describe("GET /api/peers/pending", () => {
  it("hands out the second code only to a caller that could accept", async () => {
    const plain = mintDevice("phone").device.id;
    const approver = mintDevice("tablet", null, true).device.id;
    for (const h of [
      {} as Record<string, string>,
      { "x-agentos-trust": "device", "x-agentos-device": plain },
      { "x-agentos-trust": "peer" },
    ])
      expect((await get(h)).status).toBe(200);
    await get({ "x-agentos-trust": "loopback" });
    await get({ "x-agentos-trust": "device", "x-agentos-device": approver });
    expect(seen).toEqual([
      { withCodes: false },
      { withCodes: false },
      { withCodes: false },
      { withCodes: true },
      { withCodes: true },
    ]);
  });
});
