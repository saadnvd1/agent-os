import { describe, expect, it } from "vitest";
import { connectView } from "./view";

describe("connectView", () => {
  it("is not linked before enrolment", () => {
    expect(connectView({ state: "off" })).toMatchObject({
      linked: false,
      on: false,
      canToggle: false,
    });
  });

  it("is linked and off when switched off", () => {
    expect(connectView({ state: "off", enrolled: true })).toMatchObject({
      linked: true,
      on: false,
      canToggle: true,
    });
  });

  it("is on while up or connecting", () => {
    for (const state of ["up", "connecting"] as const)
      expect(
        connectView({ state, enrolled: true, hostname: "h" })
      ).toMatchObject({
        linked: true,
        on: true,
        canToggle: true,
        hostname: "h",
      });
  });

  it("is linked but can't be toggled where Connect doesn't run", () => {
    expect(connectView({ state: "refused", enrolled: true })).toMatchObject({
      linked: true,
      canToggle: false,
    });
  });
});
