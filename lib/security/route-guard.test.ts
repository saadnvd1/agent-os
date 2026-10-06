import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { requireLocalTrust } from "./route-guard";
import { TRUST_HEADER } from "./auth";
import { isHttps } from "./cookie";

const req = (via?: string) =>
  new NextRequest("http://127.0.0.1:3011/api/pair/start", {
    method: "POST",
    headers: via ? { [TRUST_HEADER]: via } : {},
  });

describe("requireLocalTrust", () => {
  it.each(["loopback", "tailnet"])("allows %s", (via) => {
    expect(requireLocalTrust(req(via))).toBeNull();
  });
  it.each(["device", "open", undefined])("refuses %s", (via) => {
    expect(requireLocalTrust(req(via))?.status).toBe(403);
  });
});

describe("isHttps", () => {
  it("is true over TLS or behind a proxy that says https", () => {
    expect(isHttps(true)).toBe(true);
    expect(isHttps(false, "https")).toBe(true);
    expect(isHttps(false, "https, http")).toBe(true);
    expect(isHttps(false, "http")).toBe(false);
    expect(isHttps(false, null)).toBe(false);
  });
});
