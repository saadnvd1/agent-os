import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { mintDevice } from "@/lib/security/devices";
import { DEVICE_HEADER } from "@/lib/security/auth";
import { createWorkspace } from "@/lib/workspaces";

const get = (qs: string, device: string | null) =>
  GET(
    new NextRequest(`http://x/api/voice/vocab${qs}`, {
      headers: device ? { [DEVICE_HEADER]: device } : {},
    })
  );

describe("GET /api/voice/vocab", () => {
  it("needs a device, a workspace, and a known one", async () => {
    const { device } = mintDevice("phone");
    const ws = createWorkspace("Vocab");
    expect((await get(`?workspace=${ws.id}`, null)).status).toBe(403);
    expect((await get("", device.id)).status).toBe(400);
    expect((await get("?workspace=nope", device.id)).status).toBe(404);
    const res = await get(`?workspace=${ws.id}`, device.id);
    expect(res.status).toBe(200);
    const { phrases } = await res.json();
    expect(phrases).toContain("Vocab");
    expect(phrases).toContain("worktree");
  });
});
