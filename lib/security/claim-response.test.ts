import { describe, it, expect } from "vitest";
import { claimResponseBody } from "./claim-response";

const device = { id: "d1", name: "iPhone" };

describe("claimResponseBody", () => {
  it("hands a native app its token when it asks and sends no Origin", () => {
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
