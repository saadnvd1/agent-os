import { describe, expect, it } from "vitest";
import { machineDetail, machineLabel } from "./label";

describe("machineLabel", () => {
  it("marks the host and the machine you're on", () => {
    expect(machineLabel({ id: "local", name: "spark-1" })).toBe(
      "spark-1 (host)"
    );
    expect(machineLabel({ id: "pc", name: "pc" })).toBe("pc");
    expect(machineLabel({ id: "pc", name: "pc" }, "pc")).toBe(
      "pc · you're here"
    );
    expect(machineLabel({ id: "local", name: "spark-1" }, "local")).toBe(
      "spark-1 (host) · you're here"
    );
    expect(machineLabel({ id: "pc", name: "pc" }, "local")).toBe("pc");
  });
});

describe("machineDetail", () => {
  it("joins hostname and OS, skipping a hostname that is the name", () => {
    expect(
      machineDetail({
        name: "pc",
        hostname: "DESKTOP-1",
        os: "Windows",
        arch: "x64",
      })
    ).toBe("DESKTOP-1 · Windows x64");
    expect(
      machineDetail({
        name: "Spark",
        hostname: "spark",
        os: "Linux",
        arch: "arm64",
      })
    ).toBe("Linux arm64");
    expect(machineDetail({})).toBe("");
  });
});
