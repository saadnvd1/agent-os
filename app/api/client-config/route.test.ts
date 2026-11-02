import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/client-config", () => {
  it("serves the config uncached", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.v).toBe(1);
    expect(body).toHaveProperty("ownerName");
  });
});
