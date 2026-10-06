import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { requestOrigin } from "./http";

const req = (headers: Record<string, string>) =>
  new NextRequest("http://localhost:3011/api/lumifyhub/connect", { headers });

describe("requestOrigin", () => {
  it("honours a forwarded http or https", () => {
    expect(
      requestOrigin(req({ host: "box:3011", "x-forwarded-proto": "https" }))
    ).toBe("https://box:3011");
  });

  it("ignores a poisoned forwarded proto", () => {
    const origin = requestOrigin(
      req({ host: "box:3011", "x-forwarded-proto": "https://evil.example/x?" })
    );
    expect(origin).toBe("http://box:3011");
  });
});
