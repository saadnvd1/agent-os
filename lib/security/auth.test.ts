import { describe, it, expect } from "vitest";
import type { IncomingHttpHeaders } from "http";
import { authorize, isPublicPath, readToken, type AuthPolicy } from "./auth";

const TS_SELF = "100.73.93.113";
const policy: AuthPolicy = {
  tailnet: [TS_SELF],
  lookup: (t) => (t === "aosd_good" ? { id: "dev-1" } : null),
};
const req = (
  remoteAddress: string,
  headers: IncomingHttpHeaders = {},
  localAddress = remoteAddress.startsWith("100.") ? TS_SELF : "127.0.0.1"
) => ({
  url: "/api/sessions",
  headers: { host: "127.0.0.1:3011", ...headers },
  remoteAddress,
  localAddress,
});

describe("authorize", () => {
  it("trusts loopback", () => {
    expect(authorize(req("127.0.0.1"), policy)).toEqual({
      ok: true,
      via: "loopback",
    });
    expect(authorize(req("::ffff:127.0.0.1"), policy).ok).toBe(true);
    expect(authorize(req("::1"), policy).ok).toBe(true);
  });

  it.each([
    "x-forwarded-for",
    "x-forwarded-proto",
    "forwarded",
    "via",
    "x-real-ip",
    "x-client-ip",
    "true-client-ip",
    "x-original-forwarded-for",
    "cf-connecting-ip",
    "tailscale-user-login",
  ])("does not trust loopback carrying %s (a local proxy)", (h) => {
    expect(authorize(req("127.0.0.1", { [h]: "1.2.3.4" }), policy)).toEqual({
      ok: false,
    });
  });

  it.each(["localhost:3011", "[::1]:3011", "127.0.0.1"])(
    "trusts loopback addressed as %s",
    (host) => {
      expect(authorize(req("127.0.0.1", { host }), policy).ok).toBe(true);
    }
  );

  it.each(["evil.example:3011", "", "100.73.93.113:3011"])(
    "does not trust loopback addressed as %j (DNS rebinding)",
    (host) => {
      expect(authorize(req("127.0.0.1", { host }), policy).ok).toBe(false);
    }
  );

  it("never trusts a request that came through the Connect tunnel", () => {
    // A TunnelStream has no address; its Host is the machine's public name.
    const tunnel = {
      url: "/api/sessions",
      headers: { host: "k7q2mz9x.on.runagentos.com" },
      remoteAddress: undefined,
      localAddress: undefined,
    };
    expect(authorize(tunnel, policy)).toEqual({ ok: false });
    expect(
      authorize(
        { ...tunnel, headers: { ...tunnel.headers, host: "localhost" } },
        policy
      )
    ).toEqual({ ok: false });
  });

  it("refuses a malformed cookie instead of throwing", () => {
    const r = req(
      "192.168.1.20",
      { cookie: "aos_device=%E0%A4%A" },
      "192.168.1.5"
    );
    expect(() => authorize(r, policy)).not.toThrow();
    expect(authorize(r, policy)).toEqual({ ok: false });
  });

  it("refuses when the lookup itself throws (deny by default)", () => {
    const broken = {
      ...policy,
      lookup: () => {
        throw new Error("db gone");
      },
    };
    const r = req(
      "192.168.1.20",
      { cookie: "aos_device=aosd_good" },
      "192.168.1.5"
    );
    expect(authorize(r, broken)).toEqual({ ok: false });
  });

  it("lets a proxied request through with a device token", () => {
    const r = req("127.0.0.1", {
      "x-forwarded-for": "1.2.3.4",
      cookie: "aos_device=aosd_good",
    });
    expect(authorize(r, policy)).toEqual({
      ok: true,
      via: "device",
      deviceId: "dev-1",
    });
  });

  it("trusts a tailnet peer that reached the Tailscale address", () => {
    expect(authorize(req("100.99.110.86"), policy)).toEqual({
      ok: true,
      via: "tailnet",
    });
  });

  it("does not trust a 100.64/10 peer that reached another address", () => {
    expect(authorize(req("100.99.110.86", {}, "192.168.1.5"), policy).ok).toBe(
      false
    );
  });

  it("requires a token on the tailnet when asked to", () => {
    const strict = { ...policy, requireOnTailnet: true };
    expect(authorize(req("100.99.110.86"), strict).ok).toBe(false);
    expect(
      authorize(
        req("100.99.110.86", { cookie: "aos_device=aosd_good" }),
        strict
      ).ok
    ).toBe(true);
  });

  it("requires a valid token from the LAN", () => {
    const lan = (headers: IncomingHttpHeaders) =>
      req("192.168.1.20", headers, "192.168.1.5");
    expect(authorize(lan({}), policy).ok).toBe(false);
    expect(authorize(lan({ cookie: "aos_device=aosd_bad" }), policy).ok).toBe(
      false
    );
    expect(authorize(lan({ cookie: "aos_device=garbage" }), policy).ok).toBe(
      false
    );
    expect(
      authorize(lan({ cookie: "a=b; aos_device=aosd_good" }), policy).ok
    ).toBe(true);
    expect(
      authorize(lan({ authorization: "Bearer aosd_good" }), policy).ok
    ).toBe(true);
  });

  it("opens up only when auth is off", () => {
    const r = req("192.168.1.20", {}, "192.168.1.5");
    expect(authorize(r, { ...policy, off: true })).toEqual({
      ok: true,
      via: "open",
    });
  });
});

describe("isPublicPath", () => {
  it.each([
    "/pair",
    "/pair?x=1",
    "/api/pair/claim",
    "/_next/static/chunks/a.js",
    "/icon.svg",
  ])("%s is reachable before pairing", (p) =>
    expect(isPublicPath(p)).toBe(true)
  );
  it.each([
    "/",
    "/api/sessions",
    "/api/pair/start",
    "/pairing-evil",
    "/pair/x",
    "/api/exec",
    "/_next/data/x",
    "/_next/static/../../api/exec",
    "/_next/static/..%2f..%2fapi/exec",
    "/_next/static/%2e%2e/api/exec",
    "/pair/..%2fapi/exec",
    "/icons/..%5capi",
    "/icons\\..\\api",
    "//api/exec",
    "/_next/static//x",
  ])("%s is not", (p) => expect(isPublicPath(p)).toBe(false));
});

describe("readToken", () => {
  it("prefers the Authorization header", () => {
    expect(
      readToken({ authorization: "Bearer aosd_a", cookie: "aos_device=aosd_b" })
    ).toBe("aosd_a");
  });
  it("reads the cookie", () => {
    expect(readToken({ cookie: "x=1; aos_device=aosd_b" })).toBe("aosd_b");
    expect(readToken({})).toBeNull();
  });
});
