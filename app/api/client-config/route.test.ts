import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/client-config", () => {
  it("serves the config uncached", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).v).toBe(1);
  });
});
