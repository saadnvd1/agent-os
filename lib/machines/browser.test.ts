import { describe, expect, it } from "vitest";
import { browserMachine } from "./browser";

const own = ["100.64.0.1", "192.168.1.5"];
const others = [
  { hostId: "pc", addresses: ["100.64.0.7"] },
  { hostId: "origin", addresses: ["192.168.1.9"] },
];

describe("browserMachine", () => {
  it("says local for an unproxied loopback request", () => {
    expect(browserMachine("loopback", "127.0.0.1", own, others)).toEqual({
      hostId: "local",
      how: "loopback",
    });
  });

  it("says local when the request comes from this machine's own address", () => {
    expect(
      browserMachine("tailnet", "::ffff:100.64.0.1", own, others).hostId
    ).toBe("local");
  });

  it("finds a linked machine by the address it connects from", () => {
    expect(browserMachine("tailnet", "100.64.0.7", own, others)).toEqual({
      hostId: "pc",
      how: "address",
    });
    expect(browserMachine("device", "192.168.1.9", own, others).hostId).toBe(
      "origin"
    );
  });

  it("claims nothing through Connect, a peer or an unknown address", () => {
    for (const remote of ["connect", "peer", "unknown", null, "100.64.0.99"])
      expect(browserMachine("device", remote, own, others)).toEqual({
        hostId: null,
        how: null,
      });
  });

  it("does not take a loopback address for a verdict without the gate's say", () => {
    expect(browserMachine("device", "127.0.0.1", own, others).hostId).toBe(
      null
    );
  });
});
