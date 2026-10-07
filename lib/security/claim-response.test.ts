import { describe, it, expect } from "vitest";
import { claimResponseBody, claimSetsCookie } from "./claim-response";

const device = { id: "d1", name: "devbox client" };

describe("claimResponseBody", () => {
  it("hands a non-browser client its token when it asks and sends no Origin", () => {
    expect(
      claimResponseBody(device, "tok", { wantsToken: true, origin: null })
    ).toEqual({ device, token: "tok" });
  });

  it("never puts the token in the body for a browser page", () => {
    expect(
      claimResponseBody(device, "tok", {
        wantsToken: true,
        origin: "http://localhost:3011",
      })
    ).toEqual({ device });
    expect(
      claimResponseBody(device, "tok", { wantsToken: true, origin: "null" })
    ).toEqual({ device });
  });

  it("leaves the token out unless asked for exactly", () => {
    expect(claimResponseBody(device, "tok", { origin: null })).toEqual({
      device,
    });
    expect(
      claimResponseBody(device, "tok", { wantsToken: "yes", origin: null })
    ).toEqual({ device });
  });
});

describe("claimSetsCookie", () => {
  it("sets the cookie for a browser and never for a non-browser client", () => {
    const browser = claimResponseBody(device, "tok", {
      wantsToken: true,
      origin: "http://localhost:3011",
    });
    const native = claimResponseBody(device, "tok", {
      wantsToken: true,
      origin: null,
    });
    expect(claimSetsCookie(browser)).toBe(true);
    expect(claimSetsCookie(native)).toBe(false);
  });
});
