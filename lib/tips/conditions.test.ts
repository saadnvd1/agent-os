import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { mintDevice, revokeDevice } from "@/lib/security/devices";
import { tempDir } from "@/lib/test-temp";
import { tipApplies } from "./conditions";

const connectDir = tempDir("agentos-tips-connect-");
afterEach(() => {
  delete process.env.AGENTOS_CONNECT_DIR;
});

describe("tipApplies", () => {
  it("is true for a tip with no conditions", () => {
    expect(tipApplies({})).toBe(true);
  });

  it("no-paired-device flips when a device is paired and back when it is revoked", () => {
    const tip = { when: ["no-paired-device" as const] };
    const before = tipApplies(tip);
    const { device } = mintDevice("Phone", "Safari");
    expect(tipApplies(tip)).toBe(false);
    revokeDevice(device.id);
    expect(tipApplies(tip)).toBe(before);
  });

  it("connect-not-linked follows the Connect folder", () => {
    process.env.AGENTOS_CONNECT_DIR = connectDir;
    const tip = { when: ["connect-not-linked" as const] };
    expect(tipApplies(tip)).toBe(true);
    fs.writeFileSync(
      path.join(connectDir, "connect.json"),
      JSON.stringify({ machineId: "m1", apiUrl: "https://example.test" })
    );
    fs.writeFileSync(path.join(connectDir, "machine.key"), "k");
    expect(tipApplies(tip)).toBe(false);
    expect(tipApplies({ when: ["connect-linked"] })).toBe(true);
  });

  it("treats a check that throws, or an unknown one, as not applying", () => {
    const checks = {
      boom: () => {
        throw new Error("db gone");
      },
    };
    expect(tipApplies({ when: ["boom" as never] }, checks)).toBe(false);
    expect(tipApplies({ when: ["nope" as never] }, checks)).toBe(false);
  });
});
