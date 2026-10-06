import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { enrol, newMachineId } from "./enrol";

describe("enrol", () => {
  it("creates owner-only keys once, and a CSR for the machine's own name", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-enrol-"));
    const first = await enrol({
      domain: "on.test",
      relayUrl: "wss://relay.test",
      dir,
    });
    expect(first.config.machineId).toMatch(/^[a-z0-9]{8}$/);
    expect(first.config.hostname).toBe(`${first.config.machineId}.on.test`);
    for (const f of ["machine.key", "tls.key", "connect.json"]) {
      expect(fs.statSync(path.join(dir, f)).mode & 0o777).toBe(0o600);
    }
    const csr = first.csr.toString();
    expect(csr).toContain("BEGIN CERTIFICATE REQUEST");

    const again = await enrol({
      domain: "on.test",
      relayUrl: "wss://relay.test",
      dir,
    });
    expect(again.config.machineId).toBe(first.config.machineId);
    expect(again.machinePublicKey).toBe(first.machinePublicKey);
  });

  it("makes 8-character lowercase ids", () => {
    const ids = new Set(Array.from({ length: 200 }, newMachineId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{8}$/);
  });
});
