import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { isLumifyHubId } from "./ids";
import { POST } from "@/app/api/lumifyhub/cards/[cardId]/run/route";

describe("LumifyHub ids", () => {
  it("accept UUIDs only", () => {
    expect(isLumifyHubId("3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b")).toBe(true);
    expect(isLumifyHubId("../../workspaces")).toBe(false);
    expect(isLumifyHubId("42")).toBe(false);
  });

  it("the run route refuses a traversal id with 400", async () => {
    const request = new NextRequest(
      "http://localhost:3011/api/lumifyhub/cards/x/run",
      { method: "POST", body: JSON.stringify({ projectId: "p" }) }
    );
    const res = await POST(request, {
      params: Promise.resolve({ cardId: "../../workspaces" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid LumifyHub card id/);
  });
});
