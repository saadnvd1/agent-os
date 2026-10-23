import { describe, expect, it } from "vitest";
import { inMachineScope } from "./machines";

describe("inMachineScope", () => {
  it("shows everything with no scope", () => {
    expect(inMachineScope({ host_id: "pc" }, null)).toBe(true);
    expect(inMachineScope({ host_id: "" }, null)).toBe(true);
  });

  it("keeps only the chosen machine's sessions, local included", () => {
    expect(inMachineScope({ host_id: "pc" }, "pc")).toBe(true);
    expect(inMachineScope({ host_id: "pc" }, "local")).toBe(false);
    expect(inMachineScope({ host_id: "" }, "local")).toBe(true);
    expect(inMachineScope({ host_id: "local" }, "local")).toBe(true);
    expect(inMachineScope({ host_id: "" }, "pc")).toBe(false);
  });
});
